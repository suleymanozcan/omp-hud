// omp HUD extension: sci-fi style main-agent core + subagent nodes + live feed.
// Commands: /hud (full screen), /hud demo, /hud compact [on|off], /hud lang [tr|en|auto], /hud help.
import type { ExtensionAPI, ExtensionContext, Theme } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import { attachCollector } from "./src/collector.ts";
import { CompactHud } from "./src/components/compact-hud.ts";
import { FullHud } from "./src/components/full-hud.ts";
import { DemoDriver } from "./src/demo.ts";
import { createStore } from "./src/store.ts";
import type { HudStore, HudTheme } from "./src/types.ts";
import { getLang, isLangAuto, setLang, t } from "./src/i18n.ts";

const WIDGET_KEY = "hud";
const FULL_MS = 66; // ~15 fps
const COMPACT_BUSY_MS = 125; // ~8 fps
const COMPACT_IDLE_MS = 500; // 2 fps
const SETTLE_MS = 3000; // stay at the fast rate briefly after done/error

/** The real store SHARED across sessions (main + subagents), kept as a module variable. */
let sharedStore: HudStore | undefined;

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
}

const hud: HudRuntime = { interval: 0, last: 0, compactWanted: true, compactOn: false, fullOpen: false };

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
  if (!hud.compactOn) return 0;
  return isBusy(store) ? COMPACT_BUSY_MS : COMPACT_IDLE_MS;
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
  const visible = hud.compactOn || hud.fullOpen;
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
  reschedule(store);
}

function showCompact(ctx: ExtensionContext, store: HudStore): void {
  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui, theme) => {
      hud.compactTui = tui;
      return new CompactHud(store, makeTheme(theme));
    },
    { placement: "belowEditor" },
  );
  hud.ctx = ctx;
  hud.compactOn = true;
  reschedule(store);
}

function hideCompact(ctx: ExtensionContext, store: HudStore): void {
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  hud.compactOn = false;
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
      () => rowsOf(tui),
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

export default function hudExtension(pi: ExtensionAPI): void {
  const store = (sharedStore ??= createStore());

  // The collector feeds the same store from the main and subagent sessions (subagents are told apart by ctx.agent).
  attachCollector(pi, store);

  const bootCompact = (_event: unknown, ctx: ExtensionContext): void => {
    try {
      if (ctx.agent?.kind === "sub" || !isTui(ctx)) return;
      hud.ctx = ctx;
      if (hud.compactWanted) showCompact(ctx, store);
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
      hud.unsubStore?.();
      hud.unsubStore = undefined;
      hud.compactOn = false;
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
            return;
          case "compact": {
            const want = arg === "on" ? true : arg === "off" ? false : !hud.compactOn;
            hud.compactWanted = want;
            if (want) showCompact(ctx, store);
            else hideCompact(ctx, store);
            ctx.ui.notify(want ? t("cmd.panelOn") : t("cmd.panelOff"), "info");
            return;
          }
          case "lang": {
            if (arg === "tr" || arg === "en" || arg === "auto") {
              setLang(arg);
              // Cache keys include the language: a render request is enough to redraw.
              hud.compactTui?.requestRender();
              hud.fullTui?.requestRender();
            } else if (arg !== "") {
              ctx.ui.notify(t("cmd.langUsage"), "warning");
              return;
            }
            ctx.ui.notify(t("cmd.langNow", { lang: getLang(), mode: isLangAuto() ? t("cmd.langAuto") : t("cmd.langManual") }), "info");
            return;
          }
          case "help":
            ctx.ui.notify(t("cmd.help"), "info");
            return;
          default:
            ctx.ui.notify(`${t("cmd.unknown", { sub })}\n${t("cmd.help")}`, "warning");
        }
      } catch (e) {
        ctx.ui.notify(t("cmd.error", { err: errText(e) }), "error");
      }
    },
  });
}
