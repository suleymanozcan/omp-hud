// omp HUD extension: sci-fi style main-agent core + subagent nodes + live feed.
// Default view: the dock, a short panel next to the editor (you keep typing). Commands: /hud (dock on/off),
// /hud full (full screen with a conversation panel and a prompt: write to omp without leaving it), /hud size, /hud place, /hud demo [off|full], /hud compact [on|off], /hud status [on|off],
// /hud pad [0-3], /hud lang [tr|en|auto], /hud doctor, /hud help.
import type { ExtensionAPI, ExtensionContext, OverlayHandle, RegisteredCommand, Theme } from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import pkg from "./package.json" with { type: "json" };
import { attachCollector } from "./src/collector.ts";
import { CompactHud } from "./src/components/compact-hud.ts";
import { DockHud, dockHeightFor } from "./src/components/dock-hud.ts";
import { FullHud } from "./src/components/full-hud.ts";
import { PaddedComponent } from "./src/components/padded.ts";
import { DemoDriver } from "./src/demo.ts";
import { createStore } from "./src/store.ts";
import { sanitizeChatText, type ChatBridge } from "./src/chat.ts";
import type { HudStore, HudTheme } from "./src/types.ts";
import { getLang, isLangAuto, setLang, t } from "./src/i18n.ts";
import { ct } from "./src/chat-i18n.ts";
import { getPlace, getSize, parsePlace, parseSize, setPlace, setSize } from "./src/layout-settings.ts";
import { compactIsAnimated } from "./src/render/compact.ts";
import { dockIsAnimated } from "./src/render/dock.ts";
import { fmtDur } from "./src/render/fmt.ts";
import { getPad, parsePad, setPad } from "./src/pad.ts";
import { nodeCounts, statusIsAnimated, statusLineText, STATUS_MAX_COLS } from "./src/status-text.ts";
import {
  applySuggestion,
  asBase,
  commandIsKnown,
  commandName,
  findEditor,
  isUserKey,
  lineKind,
  querySuggestions,
  routeThroughEditor,
  type BaseProvider,
  type LineKind,
  type RouteEnv,
  type RouteResult,
} from "./src/slash.ts";

const COMPACT_KEY = "hud";
const DOCK_KEY = "hud-dock";
const STATUS_KEY = "hud";
const RESUME_KEY = "hud-resume";
const FULL_MS = 66; // ~15 fps
const VISIBLE_BUSY_MS = 125; // dock / compact while something is going on, ~8 fps
const DOCK_IDLE_MS = 250; // dock while idle, 4 fps (the idle core breathes and placeholder sparkles orbit)
const COMPACT_IDLE_MS = 500; // compact panel while idle, 2 fps
const STATUS_ANIM_MS = 500; // spinner cadence of the status line when nothing else is visible
const STATUS_GAP_MS = 450; // minimum gap between two setStatus writes (<= 2 Hz)
const SETTLE_MS = 3000; // stay at the fast rate briefly after done/error

/** The real store SHARED across sessions (main + subagents), kept as a module variable. */
let sharedStore: HudStore | undefined;

/** Outcome of the last call into an omp UI method (for /hud doctor). */
interface CallResult {
  ok: boolean;
  at: number;
  err?: string;
}

/** One mounted widget (dock or compact panel) and what omp did with it. */
interface WidgetInfo {
  on: boolean;
  tui?: TUI;
  call?: CallResult;
  mounted: boolean; // omp called the widget factory
  renders: number;
  lastWidth: number;
  lastLines: number;
}

function newWidget(): WidgetInfo {
  return { on: false, mounted: false, renders: 0, lastWidth: 0, lastLines: 0 };
}

type View = "dock" | "compact" | "off";

interface HudRuntime {
  ctx?: ExtensionContext; // main-session context that set up the timer
  timer?: unknown;
  timerCtx?: ExtensionContext;
  interval: number;
  last: number;
  view: View; // user preference: which panel is shown next to the editor (dock by default, never both)
  dock: WidgetInfo;
  compact: WidgetInfo;
  demo?: { store: HudStore; driver: DemoDriver }; // simulated events shown in the dock instead of the real store
  wasAnimated: boolean;
  fullOpen: boolean;
  fullHandle?: OverlayHandle; // the mounted full-screen overlay: hiding it hands the focus back to omp's editor
  base?: BaseProvider; // omp's autocomplete provider (captured through addAutocompleteProvider)
  autocompleteRegistered: boolean;
  cmdBusy: boolean; // a /command, !shell or $ python line is being run through omp's editor
  lastLine?: { kind: LineKind; res: RouteResult; at: number }; // the last such line (for /hud doctor)
  fullStore?: HudStore;
  fullTui?: TUI;
  unsubStore?: () => void;
  statusWanted: boolean; // user preference (on by default)
  statusOn: boolean;
  statusText: string; // last successfully written text
  statusWrites: number;
  statusAt: number; // ms epoch of the last write attempt
  statusCall?: CallResult;
  statusFlush?: { handle: unknown; ctx: ExtensionContext };
}

const hud: HudRuntime = {
  interval: 0,
  last: 0,
  view: "dock",
  dock: newWidget(),
  compact: newWidget(),
  wasAnimated: false,
  fullOpen: false,
  autocompleteRegistered: false,
  cmdBusy: false,
  statusWanted: true,
  statusOn: false,
  statusText: "",
  statusWrites: 0,
  statusAt: 0,
};

function makeTheme(t: Theme): HudTheme {
  const colorterm = process.env.COLORTERM;
  return {
    fg: (color, text) => (color === "text" ? text : t.fg(color, text)),
    bold: (text) => t.bold(text),
    truecolor: colorterm === "truecolor" || colorterm === "24bit",
  };
}

function isTui(ctx: ExtensionContext): boolean {
  return ctx.hasUI && ctx.mode === "tui";
}

/** Terminal size as seen by omp's TUI, else by stdout; undefined when unknown. */
function screenSize(): { rows?: number; cols?: number } {
  const term = (hud.dock.tui ?? hud.compact.tui ?? hud.fullTui)?.terminal;
  const pick = (a: number | undefined, b: number | undefined): number | undefined => {
    const v = a ?? b;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return { rows: pick(term?.rows, process.stdout.rows), cols: pick(term?.columns, process.stdout.columns) };
}

function rowsOf(tui: TUI): number {
  const rows = tui.terminal?.rows;
  return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : 30;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The store the dock currently shows: the demo's while a demo runs, else the real one. */
function dockStore(real: HudStore): HudStore {
  return hud.demo?.store ?? real;
}

function isBusy(store: HudStore): boolean {
  const { core, nodes, now } = store.state;
  if (core.status === "thinking" || core.status === "streaming" || core.status === "tool") return true;
  if (nodes.some((n) => n.status === "running")) return true;
  return (core.status === "done" || core.status === "error") && now - core.statusSince < SETTLE_MS;
}

function desiredInterval(store: HudStore): number {
  if (hud.fullOpen) return FULL_MS;
  if (hud.dock.on || hud.compact.on) {
    const busy = (hud.dock.on && isBusy(dockStore(store))) || (hud.compact.on && isBusy(store));
    return busy ? VISIBLE_BUSY_MS : hud.dock.on ? DOCK_IDLE_MS : COMPACT_IDLE_MS;
  }
  // Status line only: the text changes with the store, except for the spinner while busy.
  return hud.statusOn && statusIsAnimated(store.state) ? STATUS_ANIM_MS : 0;
}

function stopTimer(): void {
  if (hud.timer !== undefined && hud.timerCtx) {
    try {
      hud.timerCtx.clearTimer(hud.timer);
    } catch {
      // may already have been cleared
    }
  }
  hud.timer = undefined;
  hud.timerCtx = undefined;
  hud.interval = 0;
}

/** Timer policy: when nothing is visible there is neither a timer nor a subscription. */
function reschedule(store: HudStore): void {
  const ctx = hud.ctx;
  const visible = hud.dock.on || hud.compact.on || hud.fullOpen || hud.statusOn;
  if (visible && !hud.unsubStore) hud.unsubStore = store.subscribe(() => onStoreChange(store));
  else if (!visible && hud.unsubStore) {
    hud.unsubStore();
    hud.unsubStore = undefined;
  }
  const ms = ctx && visible ? desiredInterval(store) : 0;
  if (ms === hud.interval) return;
  stopTimer();
  if (ms > 0 && ctx) {
    hud.interval = ms;
    hud.last = Date.now();
    hud.timerCtx = ctx;
    hud.timer = ctx.setInterval(() => tick(store), ms);
  }
}

function onStoreChange(store: HudStore): void {
  reschedule(store);
  if (hud.compact.on) hud.compact.tui?.requestRender();
  if (hud.dock.on && !hud.demo) hud.dock.tui?.requestRender();
  syncStatus(store);
}

function tick(store: HudStore): void {
  const now = Date.now();
  const dt = now - hud.last;
  hud.last = now;
  const shown = dockStore(store);
  const full = hud.fullOpen ? hud.fullStore : undefined;
  // Every visible store advances exactly once per tick (the real store may be shown by several views).
  const toTick = new Set<HudStore>();
  if (hud.compact.on) toTick.add(store);
  if (hud.dock.on) toTick.add(shown);
  if (full) toTick.add(full);
  for (const s of toTick) s.tickAnimation(dt);
  if (hud.fullOpen) hud.fullTui?.requestRender();
  // Dock and compact only repaint while their output depends on the animation phase (and once more after it stops).
  const animated =
    (hud.dock.on && dockIsAnimated(shown.state)) || (hud.compact.on && compactIsAnimated(store.state));
  if (animated || hud.wasAnimated) {
    if (hud.dock.on) hud.dock.tui?.requestRender();
    if (hud.compact.on) hud.compact.tui?.requestRender();
  }
  hud.wasAnimated = animated;
  syncStatus(store);
  reschedule(store);
}

// --- Status line (ctx.ui.setStatus) ---

function writeStatus(ctx: ExtensionContext, text: string): void {
  const now = Date.now();
  hud.statusAt = now;
  try {
    ctx.ui.setStatus(STATUS_KEY, text);
    hud.statusText = text;
    hud.statusWrites++;
    hud.statusCall = { ok: true, at: now };
  } catch (e) {
    hud.statusCall = { ok: false, at: now, err: errText(e) };
  }
}

function cancelStatusFlush(): void {
  const f = hud.statusFlush;
  hud.statusFlush = undefined;
  if (!f) return;
  try {
    f.ctx.clearTimer(f.handle);
  } catch {
    // may already have fired
  }
}

/** Writes the status text when it changed; at most one write per STATUS_GAP_MS (a trailing write catches up). */
function syncStatus(store: HudStore): void {
  const ctx = hud.ctx;
  if (!hud.statusOn || !ctx) return;
  const now = Date.now();
  const cols = Math.min(STATUS_MAX_COLS, screenSize().cols ?? STATUS_MAX_COLS);
  const text = statusLineText(store.state, Math.floor(now / STATUS_ANIM_MS), cols);
  if (text === hud.statusText) return;
  const wait = hud.statusAt + STATUS_GAP_MS - now;
  if (wait > 0) {
    if (!hud.statusFlush) {
      const handle = ctx.setTimeout(() => {
        hud.statusFlush = undefined;
        syncStatus(store);
      }, wait);
      hud.statusFlush = { handle, ctx };
    }
    return;
  }
  writeStatus(ctx, text);
}

/** Turns the status line on (or re-applies it); false when the first write failed. */
function showStatus(ctx: ExtensionContext, store: HudStore): boolean {
  hud.ctx = ctx;
  hud.statusOn = true;
  hud.statusText = "";
  hud.statusAt = 0;
  hud.statusCall = undefined;
  cancelStatusFlush();
  syncStatus(store);
  reschedule(store);
  const call = hud.statusCall as CallResult | undefined; // syncStatus may have set it (TS cannot see through the call)
  return call?.ok !== false;
}

function hideStatus(ctx: ExtensionContext, store: HudStore): void {
  hud.statusOn = false;
  cancelStatusFlush();
  hud.statusText = "";
  try {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    hud.statusCall = { ok: true, at: Date.now() };
  } catch (e) {
    hud.statusCall = { ok: false, at: Date.now(), err: errText(e) };
  }
  reschedule(store);
}

// --- Widgets: dock (aboveEditor by default) and compact panel (belowEditor) ---

type Placement = "aboveEditor" | "belowEditor";

/** Installs a widget wrapped in the bottom padding (applies only below the editor); false when omp rejects it. */
function mountWidget(
  ctx: ExtensionContext,
  w: WidgetInfo,
  key: string,
  placement: Placement,
  make: (tui: TUI, theme: Theme) => Component,
): boolean {
  try {
    ctx.ui.setWidget(
      key,
      (tui, theme) => {
        w.tui = tui;
        w.mounted = true;
        return new PaddedComponent(make(tui, theme), () => (placement === "belowEditor" ? getPad() : 0), (width, lines) => {
          w.renders++;
          w.lastWidth = width;
          w.lastLines = lines;
        });
      },
      { placement },
    );
    w.call = { ok: true, at: Date.now() };
  } catch (e) {
    w.call = { ok: false, at: Date.now(), err: errText(e) };
    return false;
  }
  hud.ctx = ctx;
  w.on = true;
  return true;
}

function unmountWidget(ctx: ExtensionContext, w: WidgetInfo, key: string): void {
  try {
    ctx.ui.setWidget(key, undefined);
    w.call = { ok: true, at: Date.now() };
  } catch (e) {
    w.call = { ok: false, at: Date.now(), err: errText(e) };
  }
  w.on = false;
  w.mounted = false;
  w.tui = undefined;
}

function showCompact(ctx: ExtensionContext, store: HudStore): boolean {
  const ok = mountWidget(ctx, hud.compact, COMPACT_KEY, "belowEditor", (_tui, theme) => new CompactHud(store, makeTheme(theme)));
  reschedule(store);
  return ok;
}

function hideCompact(ctx: ExtensionContext, store: HudStore): void {
  unmountWidget(ctx, hud.compact, COMPACT_KEY);
  reschedule(store);
}

/** (Re)installs the dock for the current size/place, bound to the demo store while a demo runs. */
function showDock(ctx: ExtensionContext, store: HudStore): boolean {
  const target = dockStore(store);
  const placement: Placement = getPlace() === "above" ? "aboveEditor" : "belowEditor";
  const ok = mountWidget(
    ctx,
    hud.dock,
    DOCK_KEY,
    placement,
    (tui, theme) => new DockHud(target, makeTheme(theme), { getSize, getRows: () => rowsOf(tui) }),
  );
  hud.wasAnimated = true; // paint the first frames right away
  reschedule(store);
  return ok;
}

function hideDock(ctx: ExtensionContext, store: HudStore): void {
  unmountWidget(ctx, hud.dock, DOCK_KEY);
  reschedule(store);
}

/** Stops a running dock demo without touching the widgets; true when one was running. */
function dropDemo(): boolean {
  const d = hud.demo;
  if (!d) return false;
  hud.demo = undefined;
  d.driver.stop();
  return true;
}

/** Makes the widgets match `view` (dock and compact never show together); false when the wanted one failed to mount. */
function applyView(ctx: ExtensionContext, store: HudStore, view: View): boolean {
  if (view !== "dock" && hud.dock.on) hideDock(ctx, store);
  if (view !== "compact" && hud.compact.on) hideCompact(ctx, store);
  if (view === "dock") return showDock(ctx, store);
  if (view === "compact") return showCompact(ctx, store);
  return true;
}

function startDemo(ctx: ExtensionContext, store: HudStore): boolean {
  dropDemo();
  const demoStore = createStore();
  const driver = new DemoDriver(demoStore, {
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    clearTimer: (handle) => ctx.clearTimer(handle),
  });
  driver.start();
  hud.demo = { store: demoStore, driver };
  if (hud.compact.on) hideCompact(ctx, store);
  if (showDock(ctx, store)) return true;
  dropDemo();
  applyView(ctx, store, hud.view);
  return false;
}

const FULL_OVERLAY = { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } as const;

/** Full-screen HUD; `target` is the real or the demo store, `bridge` connects its prompt. `onClosed` is called on close. */
async function openFull(
  ctx: ExtensionContext,
  real: HudStore,
  target: HudStore,
  bridge: ChatBridge,
  onClosed?: () => void,
): Promise<void> {
  if (hud.fullOpen) return;
  hud.ctx = ctx;
  hud.fullOpen = true;
  hud.fullStore = target;
  reschedule(real);
  const factory = (tui: TUI, theme: Theme, _keys: unknown, done: (r: undefined) => void) => {
    hud.fullTui = tui;
    return new FullHud(
      target,
      makeTheme(theme),
      () => tui.requestRender(),
      () => done(undefined),
      () => Math.max(1, rowsOf(tui) - getPad()), // keep the last row(s) free: the prompt hint must stay visible
      bridge,
    );
  };
  const onHandle = (handle: OverlayHandle): void => {
    hud.fullHandle = handle;
  };
  try {
    try {
      await ctx.ui.custom<undefined>(factory, {
        overlay: true,
        overlayOptions: { ...FULL_OVERLAY, fullscreen: true },
        onHandle,
      });
    } catch {
      // `fullscreen` is an undocumented field: fall back to a normal overlay if a new version breaks it
      await ctx.ui.custom<undefined>(factory, {
        overlay: true,
        overlayOptions: { ...FULL_OVERLAY, fullscreen: false },
        onHandle,
      });
    }
  } finally {
    hud.fullHandle = undefined;
    hud.fullOpen = false;
    hud.fullStore = undefined;
    hud.fullTui = undefined;
    try {
      onClosed?.();
    } finally {
      reschedule(real);
    }
  }
}

/** What the editor route needs from omp, bound to the mounted full-screen overlay `handle`. */
function routeEnv(ctx: ExtensionContext, handle: OverlayHandle): RouteEnv {
  return {
    tui: () => hud.fullTui,
    getText: () => ctx.ui.getEditorText(),
    setText: (text) => ctx.ui.setEditorText(text),
    hide: () => handle.setHidden(true),
    show: () => {
      handle.setHidden(false);
      hud.fullTui?.requestRender();
    },
    alive: () => hud.fullOpen && hud.fullHandle === handle,
    sleep: (ms) => new Promise<void>((resolve) => void setTimeout(resolve, ms)),
    pause(onKey) {
      let off: (() => void) | undefined;
      const cancel = (): void => {
        off?.();
        off = undefined;
        try {
          ctx.ui.setStatus(RESUME_KEY, undefined);
        } catch {
          // the status line may already be gone
        }
      };
      try {
        ctx.ui.setStatus(RESUME_KEY, ct("slash.resume"));
        off = ctx.ui.onTerminalInput((data) => {
          if (!isUserKey(data)) return undefined;
          cancel();
          onKey();
          return { consume: true }; // the key that brings the HUD back is not typed into the editor
        });
      } catch {
        // without a key listener nothing could ever bring the HUD back: return at once
        cancel();
        onKey();
      }
      return cancel;
    },
  };
}

/** `/hud doctor` line about the slash-command route: editor found, autocomplete provider, the last command. */
function slashDoctorLine(): string {
  const yn = (b: boolean): string => (b ? t("doc.yes") : t("doc.no"));
  const tui = hud.fullTui ?? hud.dock.tui ?? hud.compact.tui;
  const found = tui ? findEditor(tui) : undefined;
  const editor = found ? `${yn(found.editor !== undefined)} (${found.via})` : t("doc.unknown");
  const base = hud.base ? yn(true) : `${yn(false)} (${hud.autocompleteRegistered ? t("doc.on") : t("doc.off")})`;
  const last = hud.lastLine;
  const lastText = last
    ? ct("slash.last", {
        kind: last.kind,
        via: last.res.via,
        result: last.res.error ?? (last.res.paused ? ct("slash.focusKept") : last.res.left ? ct("slash.focusLeft") : "ok"),
        ms: last.res.ms,
      })
    : ct("slash.none");
  return ct("slash.doctor", { editor, base, last: lastText });
}

async function runFullDemo(ctx: ExtensionContext, real: HudStore, bridgeFor: (target: HudStore) => ChatBridge): Promise<void> {
  const demoStore = createStore();
  const driver = new DemoDriver(demoStore, {
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    clearTimer: (handle) => ctx.clearTimer(handle),
  });
  driver.start();
  await openFull(ctx, real, demoStore, bridgeFor(demoStore), () => driver.stop());
  driver.stop(); // stop for sure even if openFull returned without ever opening
}

// --- /hud doctor ---

function ago(ts: number): string {
  return t("doc.ago", { s: Math.max(0, Math.round((Date.now() - ts) / 1000)) });
}

function callText(c: CallResult | undefined): string {
  if (!c) return t("doc.never");
  return c.ok ? t("doc.ok", { ago: ago(c.at) }) : t("doc.failed", { err: c.err ?? "?" });
}

/** Multi-line diagnostics. Only the HUD env values that are documented are shown; no other environment access. */
function doctorText(ctx: ExtensionContext, store: HudStore): string {
  const yn = (b: boolean): string => (b ? t("doc.yes") : t("doc.no"));
  const onOff = (b: boolean): string => (b ? t("doc.on") : t("doc.off"));
  const unk = t("doc.unknown");
  const { state } = store;
  const { rows, cols } = screenSize();
  const pad = getPad();
  const lastRender = (w: WidgetInfo): string => (w.renders > 0 ? t("doc.lastRender", { w: w.lastWidth, n: w.lastLines }) : "");
  const lastFeed = state.feed[state.feed.length - 1];
  const counts = nodeCounts(state.nodes);
  const hz = hud.interval > 0 ? Math.round((1000 / hud.interval) * 10) / 10 : 0;
  const { dock, compact } = hud;
  const lines = [
    t("doc.title"),
    t("doc.version", { v: String(pkg.version) }),
    t("doc.lang", {
      lang: getLang(),
      mode: isLangAuto() ? t("cmd.langAuto") : t("cmd.langManual"),
      env: (process.env.OMP_HUD_LANG ?? "-").slice(0, 8),
      ct: (process.env.COLORTERM ?? "-").slice(0, 12),
    }),
    t("doc.mode", { mode: ctx.mode ?? unk, ui: yn(ctx.hasUI) }),
    t("doc.dock", {
      state: onOff(dock.on),
      size: getSize(),
      rows: dockHeightFor(getSize(), rows ?? 30),
      place: getPlace(),
      call: callText(dock.call),
      mounted: yn(dock.mounted),
      n: dock.renders,
      last: lastRender(dock),
    }),
    t("doc.demo", { state: hud.demo ? t("doc.demoDock") : t("doc.demoNone") }),
    t("doc.widget", {
      state: onOff(compact.on),
      call: callText(compact.call),
      mounted: yn(compact.mounted),
      n: compact.renders,
      last: lastRender(compact),
    }),
    t("doc.status", {
      state: onOff(hud.statusOn),
      call: callText(hud.statusCall),
      n: hud.statusWrites,
      text: hud.statusText === "" ? t("doc.none") : `"${hud.statusText}"`,
    }),
    t("doc.screen", {
      rows: rows ?? unk,
      cols: cols ?? unk,
      pad,
      full: rows === undefined ? unk : Math.max(1, rows - pad),
      lines: compact.on && compact.renders > 0 ? `${compact.lastLines} (${Math.max(0, compact.lastLines - pad)} + pad ${pad})` : "0",
    }),
    t("doc.store", {
      ver: store.version,
      core: t(`status.${state.core.status}`),
      since: fmtDur(Date.now() - state.core.statusSince),
      nodes: counts === "" ? t("doc.none") : counts,
      event: lastFeed ? ago(lastFeed.t) : t("doc.none"),
    }),
    t("doc.timer", {
      timer: hud.interval > 0 ? t("doc.timerRunning", { ms: hud.interval, hz }) : t("doc.timerStopped"),
    }),
    slashDoctorLine(),
  ];
  return lines.join("\n");
}

function placeText(): string {
  return t(`place.${getPlace()}`);
}

function requestRenders(): void {
  hud.dock.tui?.requestRender();
  hud.compact.tui?.requestRender();
  hud.fullTui?.requestRender();
}

export default function hudExtension(pi: ExtensionAPI): void {
  const store = (sharedStore ??= createStore());

  // The collector feeds the same store from the main and subagent sessions (subagents are told apart by ctx.agent).
  attachCollector(pi, store);

  const bootView = (_event: unknown, ctx: ExtensionContext): void => {
    try {
      if (ctx.agent?.kind === "sub" || !isTui(ctx)) return;
      hud.ctx = ctx;
      dropDemo(); // a demo never survives a session change
      if (!applyView(ctx, store, hud.view)) {
        const failed = hud.view === "dock" ? hud.dock : hud.compact;
        ctx.ui.notify(t(hud.view === "dock" ? "cmd.dockFailed" : "cmd.compactFailed", { err: failed.call?.err ?? "?" }), "warning");
      }
      if (hud.statusWanted) showStatus(ctx, store);
    } catch (e) {
      try {
        ctx.ui.notify(t("cmd.openFailed", { err: errText(e) }), "warning");
      } catch {
        // the notification could not be shown either
      }
    }
  };
  pi.on("session_start", bootView);
  // omp's own autocomplete provider (the base the command palette reads); the registration cannot be undone, so once per process.
  pi.on("session_start", (_event, ctx) => {
    try {
      if (hud.autocompleteRegistered || ctx.agent?.kind === "sub" || !isTui(ctx) || typeof ctx.ui.addAutocompleteProvider !== "function") return;
      hud.autocompleteRegistered = true;
      ctx.ui.addAutocompleteProvider((base) => {
        hud.base = asBase(base);
        return base;
      });
    } catch {
      hud.autocompleteRegistered = false;
    }
  });
  pi.on("session_switch", bootView);

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      if (ctx.agent?.kind === "sub") return;
      stopTimer();
      cancelStatusFlush();
      dropDemo();
      if (hud.statusOn) {
        try {
          ctx.ui.setStatus(STATUS_KEY, undefined);
        } catch {
          // the UI may already be gone
        }
      }
      hud.statusOn = false;
      hud.statusText = "";
      hud.unsubStore?.();
      hud.unsubStore = undefined;
      for (const w of [hud.dock, hud.compact]) {
        w.on = false;
        w.mounted = false;
        w.tui = undefined;
      }
      hud.fullOpen = false;
      hud.fullHandle = undefined;
      hud.ctx = undefined;
    } catch {
      // swallow
    }
  });

  const hudCommand: RegisteredCommand = {
    description: t("cmd.description"),
    handler: async (args, ctx) => {
      if (!isTui(ctx)) return;
      const [sub = "", arg = ""] = args.trim().toLowerCase().split(/\s+/);
      try {
        switch (sub) {
          case "": {
            // Toggle the dock.
            if (hud.dock.on) {
              dropDemo();
              hud.view = "off";
              hideDock(ctx, store);
              ctx.ui.notify(t("cmd.dockOff"), "info");
              return;
            }
            const switched = hud.compact.on;
            hud.view = "dock";
            if (!applyView(ctx, store, "dock")) {
              ctx.ui.notify(t("cmd.dockFailed", { err: hud.dock.call?.err ?? "?" }), "error");
              return;
            }
            ctx.ui.notify(t(switched ? "cmd.dockOnSwitched" : "cmd.dockOn", { size: getSize(), place: placeText() }), "info");
            return;
          }
          case "full":
            await openFull(ctx, store, store, makeBridge(ctx, store));
            return;
          case "size": {
            if (arg !== "") {
              const size = parseSize(arg);
              if (size === undefined) {
                ctx.ui.notify(t("cmd.sizeUsage"), "warning");
                return;
              }
              setSize(size);
              requestRenders();
            }
            ctx.ui.notify(t("cmd.sizeNow", { size: getSize(), rows: dockHeightFor(getSize(), screenSize().rows ?? 30) }), "info");
            return;
          }
          case "place": {
            if (arg !== "") {
              const place = parsePlace(arg);
              if (place === undefined) {
                ctx.ui.notify(t("cmd.placeUsage"), "warning");
                return;
              }
              setPlace(place);
              if (hud.dock.on) {
                // A widget cannot change its placement in place: take it out and put it back.
                hideDock(ctx, store);
                if (!showDock(ctx, store)) {
                  ctx.ui.notify(t("cmd.dockFailed", { err: hud.dock.call?.err ?? "?" }), "error");
                  return;
                }
              }
            }
            ctx.ui.notify(t("cmd.placeNow", { place: placeText() }), "info");
            return;
          }
          case "demo": {
            if (arg === "full") {
              await runFullDemo(ctx, store, (target) => makeBridge(ctx, target));
              ctx.ui.notify(t("cmd.demoClosed"), "info");
              return;
            }
            if (arg !== "" && arg !== "off") {
              ctx.ui.notify(t("cmd.demoUsage"), "warning");
              return;
            }
            if (hud.demo || arg === "off") {
              if (!hud.demo) {
                ctx.ui.notify(t("cmd.demoNone"), "info");
                return;
              }
              dropDemo();
              applyView(ctx, store, hud.view); // back to the real store (or off when the dock was only opened for the demo)
              ctx.ui.notify(t("cmd.demoOff"), "info");
              return;
            }
            if (!startDemo(ctx, store)) {
              ctx.ui.notify(t("cmd.dockFailed", { err: hud.dock.call?.err ?? "?" }), "error");
              return;
            }
            ctx.ui.notify(t("cmd.demoOn"), "info");
            return;
          }
          case "compact": {
            const on = hud.compact.on;
            const want = arg === "on" ? true : arg === "off" ? false : !on;
            if (want) {
              // Compact replaces the dock: showing both would repeat the same data twice.
              const switched = hud.dock.on;
              dropDemo();
              hud.view = "compact";
              if (!applyView(ctx, store, "compact")) {
                ctx.ui.notify(t("cmd.compactFailed", { err: hud.compact.call?.err ?? "?" }), "error");
                return;
              }
              ctx.ui.notify(t(on ? "cmd.compactAlreadyOn" : switched ? "cmd.compactOnSwitched" : "cmd.compactOn"), "info");
            } else if (on) {
              hud.view = "off";
              hideCompact(ctx, store);
              ctx.ui.notify(t("cmd.compactOff"), "info");
            } else {
              ctx.ui.notify(t("cmd.compactAlreadyOff"), "info");
            }
            return;
          }
          case "status": {
            if (arg !== "" && arg !== "on" && arg !== "off") {
              ctx.ui.notify(t("cmd.statusUsage"), "warning");
              return;
            }
            if (arg === "") {
              ctx.ui.notify(t(hud.statusOn ? "cmd.statusOn" : "cmd.statusOff"), "info");
              return;
            }
            const want = arg === "on";
            const already = want === hud.statusOn;
            hud.statusWanted = want;
            if (want) {
              if (!showStatus(ctx, store)) {
                ctx.ui.notify(t("cmd.statusFailed", { err: hud.statusCall?.err ?? "?" }), "error");
                return;
              }
              ctx.ui.notify(t(already ? "cmd.statusAlreadyOn" : "cmd.statusOn"), "info");
            } else {
              hideStatus(ctx, store);
              ctx.ui.notify(t(already ? "cmd.statusAlreadyOff" : "cmd.statusOff"), "info");
            }
            return;
          }
          case "pad": {
            if (arg !== "") {
              const n = parsePad(arg);
              if (n === undefined) {
                ctx.ui.notify(t("cmd.padUsage"), "warning");
                return;
              }
              setPad(n);
              requestRenders();
            }
            ctx.ui.notify(t("cmd.padNow", { n: getPad() }), "info");
            return;
          }
          case "lang": {
            if (arg === "tr" || arg === "en" || arg === "auto") {
              setLang(arg);
              // Cache keys include the language: a render request is enough to redraw.
              requestRenders();
              if (hud.statusOn) syncStatus(store);
            } else if (arg !== "") {
              ctx.ui.notify(t("cmd.langUsage"), "warning");
              return;
            }
            ctx.ui.notify(t("cmd.langNow", { lang: getLang(), mode: isLangAuto() ? t("cmd.langAuto") : t("cmd.langManual") }), "info");
            return;
          }
          case "doctor":
            ctx.ui.notify(doctorText(ctx, store), "info");
            return;
          case "help":
            ctx.ui.notify(helpText(), "info");
            return;
          default:
            ctx.ui.notify(`${t("cmd.unknown", { sub })}\n${helpText()}`, "warning");
        }
      } catch (e) {
        ctx.ui.notify(t("cmd.error", { err: errText(e) }), "error");
      }
    },
  };
  pi.registerCommand("hud", hudCommand);

  /** What the prompt of the full-screen HUD can do: send text to omp (real store) or play along (demo store), and run `/hud ...` locally. */
  function makeBridge(ctx: ExtensionContext, target: HudStore): ChatBridge {
    const demo = target !== store;
    const say = (text: string): void => {
      target.addChat({ role: "system", text });
    };
    return {
      send(text, mode) {
        if (demo) {
          target.addChat({ role: "user", text });
          say(ct("chat.demoReply"));
          return;
        }
        const idle = typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
        const id = target.addChat({ role: "user", text, pending: idle ? "sending" : mode });
        try {
          // Idle: a normal prompt. Busy, Enter: no `deliverAs`, which omp treats as a steer while streaming, exactly like
          // the editor's Enter (and it still starts a turn if the agent finished since the check). Busy, Alt+Enter: `followUp`.
          if (idle || mode === "steer") pi.sendUserMessage(text);
          else pi.sendUserMessage(text, { deliverAs: "followUp" });
        } catch (e) {
          target.removeChat(id);
          say(ct("chat.sendFailed", { err: errText(e) }));
        }
      },
      command(args) {
        const [sub = "", arg = ""] = args.trim().toLowerCase().split(/\s+/);
        if (sub === "full" || (sub === "demo" && arg === "full")) {
          say(ct("chat.alreadyFull"));
          return;
        }
        // The command's notifications would be hidden behind the full-screen overlay: they go into the conversation panel.
        const ui = new Proxy(ctx.ui, {
          get(obj, prop) {
            if (prop === "notify") return (message: string) => say(message);
            const v = Reflect.get(obj, prop, obj) as unknown;
            return typeof v === "function" ? v.bind(obj) : v;
          },
        });
        const local = new Proxy(ctx, {
          get(obj, prop) {
            if (prop === "ui") return ui;
            const v = Reflect.get(obj, prop, obj) as unknown;
            return typeof v === "function" ? v.bind(obj) : v;
          },
        });
        void hudCommand.handler(args, local);
      },
      async runLine(text) {
        if (demo) {
          target.addChat({ role: "user", text });
          say(ct("chat.demoReply"));
          return "ran";
        }
        if (hud.cmdBusy) {
          say(ct("chat.cmdBusy"));
          return "refused";
        }
        hud.cmdBusy = true;
        try {
          const kind = lineKind(text);
          if (kind === "command") {
            const name = commandName(text);
            // omp sends an unknown /x to the model as plain text: refuse it here, where it costs nothing.
            if ((await commandIsKnown(hud.base, name)) === false) {
              say(ct("chat.unknownCommand", { name }));
              return "refused";
            }
          }
          const handle = hud.fullHandle;
          if (!handle) {
            say(ct("chat.cmdNoHandle"));
            return "refused";
          }
          const res = await routeThroughEditor(routeEnv(ctx, handle), text);
          hud.lastLine = { kind, res, at: Date.now() };
          hud.fullTui?.requestRender();
          if (!res.ok) {
            say(res.error === "no-editor" ? ct("chat.cmdNoEditor") : res.error === "submit-disabled" ? ct("chat.cmdSubmitOff") : ct("chat.cmdFailed", { err: res.detail ?? "?" }));
            return "refused";
          }
          say(ct("chat.cmdRan", { line: sanitizeChatText(text).slice(0, 80) }));
          return "ran";
        } finally {
          hud.cmdBusy = false;
        }
      },
      async suggest(text, cursor, signal) {
        return demo || !hud.base ? null : querySuggestions(hud.base, text, cursor, signal);
      },
      apply(text, cursor, item, prefix) {
        return hud.base ? applySuggestion(hud.base, text, cursor, item, prefix) : undefined;
      },
    };
  }
}

function helpText(): string {
  return `${t("cmd.help", { pad: getPad(), size: getSize(), place: getPlace() })}\n${ct("chat.help")}`;
}
