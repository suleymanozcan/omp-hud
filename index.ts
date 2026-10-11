// omp HUD extension: sci-fi style main-agent core + subagent nodes + live feed.
// Commands: /hud (full screen), /hud demo, /hud compact [on|off], /hud status [on|off], /hud pad [0-3],
// /hud lang [tr|en|auto], /hud doctor, /hud help.
import type { ExtensionAPI, ExtensionContext, Theme } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import pkg from "./package.json" with { type: "json" };
import { attachCollector } from "./src/collector.ts";
import { CompactHud } from "./src/components/compact-hud.ts";
import { FullHud } from "./src/components/full-hud.ts";
import { PaddedComponent } from "./src/components/padded.ts";
import { DemoDriver } from "./src/demo.ts";
import { createStore } from "./src/store.ts";
import type { HudStore, HudTheme } from "./src/types.ts";
import { getLang, isLangAuto, setLang, t } from "./src/i18n.ts";
import { fmtDur } from "./src/render/fmt.ts";
import { getPad, parsePad, setPad } from "./src/pad.ts";
import { nodeCounts, statusIsAnimated, statusLineText, STATUS_MAX_COLS } from "./src/status-text.ts";

const WIDGET_KEY = "hud";
const STATUS_KEY = "hud";
const FULL_MS = 66; // ~15 fps
const COMPACT_BUSY_MS = 125; // ~8 fps
const COMPACT_IDLE_MS = 500; // 2 fps
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

interface HudRuntime {
  ctx?: ExtensionContext; // main-session context that set up the timer
  timer?: unknown;
  timerCtx?: ExtensionContext;
  interval: number;
  last: number;
  compactWanted: boolean; // user preference (on by default)
  compactOn: boolean;
  compactTui?: TUI;
  fullOpen: boolean;
  fullStore?: HudStore;
  fullTui?: TUI;
  unsubStore?: () => void;
  widgetCall?: CallResult;
  mounted: boolean; // omp called the widget factory
  renders: number;
  lastRenderWidth: number;
  lastRenderLines: number;
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
  compactWanted: true,
  compactOn: false,
  fullOpen: false,
  mounted: false,
  renders: 0,
  lastRenderWidth: 0,
  lastRenderLines: 0,
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
  const term = (hud.compactTui ?? hud.fullTui)?.terminal;
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

function isBusy(store: HudStore): boolean {
  const { core, nodes, now } = store.state;
  if (core.status === "thinking" || core.status === "streaming" || core.status === "tool") return true;
  if (nodes.some((n) => n.status === "running")) return true;
  return (core.status === "done" || core.status === "error") && now - core.statusSince < SETTLE_MS;
}

function desiredInterval(store: HudStore): number {
  if (hud.fullOpen) return FULL_MS;
  if (hud.compactOn) return isBusy(store) ? COMPACT_BUSY_MS : COMPACT_IDLE_MS;
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
  const visible = hud.compactOn || hud.fullOpen || hud.statusOn;
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
  if (hud.compactOn) hud.compactTui?.requestRender();
  syncStatus(store);
}

function tick(store: HudStore): void {
  const now = Date.now();
  const dt = now - hud.last;
  hud.last = now;
  const full = hud.fullOpen ? hud.fullStore : undefined;
  if (hud.compactOn || full === store) store.tickAnimation(dt);
  if (full && full !== store) full.tickAnimation(dt);
  if (hud.fullOpen) hud.fullTui?.requestRender();
  if (hud.compactOn) hud.compactTui?.requestRender();
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

// --- Compact widget ---

/** Installs the compact widget; false (with the error recorded) when omp rejects it. */
function showCompact(ctx: ExtensionContext, store: HudStore): boolean {
  try {
    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        hud.compactTui = tui;
        hud.mounted = true;
        return new PaddedComponent(new CompactHud(store, makeTheme(theme)), getPad, (width, lines) => {
          hud.renders++;
          hud.lastRenderWidth = width;
          hud.lastRenderLines = lines;
        });
      },
      { placement: "belowEditor" },
    );
    hud.widgetCall = { ok: true, at: Date.now() };
  } catch (e) {
    hud.widgetCall = { ok: false, at: Date.now(), err: errText(e) };
    return false;
  }
  hud.ctx = ctx;
  hud.compactOn = true;
  reschedule(store);
  return true;
}

function hideCompact(ctx: ExtensionContext, store: HudStore): void {
  try {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    hud.widgetCall = { ok: true, at: Date.now() };
  } catch (e) {
    hud.widgetCall = { ok: false, at: Date.now(), err: errText(e) };
  }
  hud.compactOn = false;
  hud.mounted = false;
  hud.compactTui = undefined;
  reschedule(store);
}

const FULL_OVERLAY = { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } as const;

/** Full-screen HUD; `target` is the real or the demo store. `onClosed` is called on close. */
async function openFull(
  ctx: ExtensionContext,
  real: HudStore,
  target: HudStore,
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
      () => Math.max(1, rowsOf(tui) - getPad()), // keep the last row(s) free: the hint line must stay visible
    );
  };
  try {
    try {
      await ctx.ui.custom<undefined>(factory, {
        overlay: true,
        overlayOptions: { ...FULL_OVERLAY, fullscreen: true },
      });
    } catch {
      // `fullscreen` is an undocumented field: fall back to a normal overlay if a new version breaks it
      await ctx.ui.custom<undefined>(factory, {
        overlay: true,
        overlayOptions: { ...FULL_OVERLAY, fullscreen: false },
      });
    }
  } finally {
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

async function runDemo(ctx: ExtensionContext, real: HudStore): Promise<void> {
  const demoStore = createStore();
  const driver = new DemoDriver(demoStore, {
    setInterval: (fn, ms) => ctx.setInterval(fn, ms),
    clearTimer: (handle) => ctx.clearTimer(handle),
  });
  driver.start();
  await openFull(ctx, real, demoStore, () => driver.stop());
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

/** Multi-line diagnostics. Only the two documented HUD env values are shown; no other environment access. */
function doctorText(ctx: ExtensionContext, store: HudStore): string {
  const yn = (b: boolean): string => (b ? t("doc.yes") : t("doc.no"));
  const onOff = (b: boolean): string => (b ? t("doc.on") : t("doc.off"));
  const unk = t("doc.unknown");
  const { state } = store;
  const { rows, cols } = screenSize();
  const pad = getPad();
  const lastRender = hud.renders > 0 ? t("doc.lastRender", { w: hud.lastRenderWidth, n: hud.lastRenderLines }) : "";
  const lastFeed = state.feed[state.feed.length - 1];
  const counts = nodeCounts(state.nodes);
  const hz = hud.interval > 0 ? Math.round((1000 / hud.interval) * 10) / 10 : 0;
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
    t("doc.widget", {
      state: onOff(hud.compactOn),
      call: callText(hud.widgetCall),
      mounted: yn(hud.mounted),
      n: hud.renders,
      last: lastRender,
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
      lines: hud.compactOn && hud.renders > 0 ? `${hud.lastRenderLines} (${Math.max(0, hud.lastRenderLines - pad)} + pad ${pad})` : "0",
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
  ];
  return lines.join("\n");
}

export default function hudExtension(pi: ExtensionAPI): void {
  const store = (sharedStore ??= createStore());

  // The collector feeds the same store from the main and subagent sessions (subagents are told apart by ctx.agent).
  attachCollector(pi, store);

  const bootCompact = (_event: unknown, ctx: ExtensionContext): void => {
    try {
      if (ctx.agent?.kind === "sub" || !isTui(ctx)) return;
      hud.ctx = ctx;
      if (hud.compactWanted && !showCompact(ctx, store)) {
        ctx.ui.notify(t("cmd.compactFailed", { err: hud.widgetCall?.err ?? "?" }), "warning");
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
  pi.on("session_start", bootCompact);
  pi.on("session_switch", bootCompact);

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      if (ctx.agent?.kind === "sub") return;
      stopTimer();
      cancelStatusFlush();
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
      hud.compactOn = false;
      hud.mounted = false;
      hud.compactTui = undefined;
      hud.fullOpen = false;
      hud.ctx = undefined;
    } catch {
      // swallow
    }
  });

  pi.registerCommand("hud", {
    description: t("cmd.description"),
    handler: async (args, ctx) => {
      if (!isTui(ctx)) return;
      const [sub = "", arg = ""] = args.trim().toLowerCase().split(/\s+/);
      try {
        switch (sub) {
          case "":
            await openFull(ctx, store, store);
            return;
          case "demo":
            await runDemo(ctx, store);
            ctx.ui.notify(t("cmd.demoClosed"), "info");
            return;
          case "compact": {
            const want = arg === "on" ? true : arg === "off" ? false : !hud.compactOn;
            const already = want === hud.compactOn;
            hud.compactWanted = want;
            if (want) {
              if (!showCompact(ctx, store)) {
                ctx.ui.notify(t("cmd.compactFailed", { err: hud.widgetCall?.err ?? "?" }), "error");
                return;
              }
              ctx.ui.notify(t(already ? "cmd.compactAlreadyOn" : "cmd.compactOn"), "info");
            } else {
              hideCompact(ctx, store);
              ctx.ui.notify(t(already ? "cmd.compactAlreadyOff" : "cmd.compactOff"), "info");
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
              hud.compactTui?.requestRender();
              hud.fullTui?.requestRender();
            }
            ctx.ui.notify(t("cmd.padNow", { n: getPad() }), "info");
            return;
          }
          case "lang": {
            if (arg === "tr" || arg === "en" || arg === "auto") {
              setLang(arg);
              // Cache keys include the language: a render request is enough to redraw.
              hud.compactTui?.requestRender();
              hud.fullTui?.requestRender();
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
            ctx.ui.notify(t("cmd.help", { pad: getPad() }), "info");
            return;
          default:
            ctx.ui.notify(`${t("cmd.unknown", { sub })}\n${t("cmd.help", { pad: getPad() })}`, "warning");
        }
      } catch (e) {
        ctx.ui.notify(t("cmd.error", { err: errText(e) }), "error");
      }
    },
  });
}
