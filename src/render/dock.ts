// Dock: the HUD as a short panel above the editor (4-14 rows). Pure render; no frame, only a thin rule on top.
//   wide   (width >= 70, height >= 6): orbit scene on the left, rule + feed + tasks + tokens on the right
//   narrow (otherwise)                : compact status rows + the tail of the live feed
import type { HudState, HudTheme } from "../types.ts";
import { dt } from "../dock-i18n.ts";
import { t } from "../i18n.ts";
import { trunc, vw } from "../util/text.ts";
import { compactIsAnimated, renderCompact } from "./compact.ts";
import { renderFeed } from "./feed.ts";
import { coreColor, fmtCost, fmtNum, spinnerFor, taskSpinner } from "./fmt.ts";
import { renderOrbitScene } from "./orbit-scene.ts";
import { tasksHeader } from "./tasks.ts";
import { ctxBar } from "./tokens.ts";

export const DOCK_MIN_HEIGHT = 4;
export const DOCK_MAX_HEIGHT = 14;
/** Orbit scene is drawn when the dock is at least this wide and tall. */
const ORBIT_MIN_WIDTH = 70;
const ORBIT_MIN_HEIGHT = 6;
/** Wide orbit (26-30 columns) from this size up; narrower dock layouts use 22 columns. */
const WIDE_WIDTH = 90;
const WIDE_HEIGHT = 8;
const ORBIT_GAP = 2;
/** The dock keeps animating for a moment after a status change / node end (flash, done pulse, end ripple). */
const STATUS_FX_MS = 3000;
const NODE_FX_MS = 1000;

/** Whether the dock output depends on the animation phase right now (drives the frame bucket of the cache). */
export function dockIsAnimated(state: HudState): boolean {
  if (compactIsAnimated(state) || state.core.warning) return true;
  const now = state.now;
  if (now - state.core.statusSince < STATUS_FX_MS) return true;
  for (const n of state.nodes) if (n.endedAt !== undefined && now - n.endedAt < NODE_FX_MS) return true;
  return false;
}

function rule(n: number, theme: HudTheme): string {
  return n > 0 ? theme.fg("dim", "─".repeat(n)) : "";
}

function statusChip(state: HudState, theme: HudTheme): string {
  const { core } = state;
  const color = coreColor(core.status);
  const active = core.status === "thinking" || core.status === "streaming" || core.status === "tool";
  const glyph = active ? spinnerFor(core.status, state.phase) : core.status === "error" ? "✗" : core.status === "done" ? "✓" : "○";
  let label: string;
  switch (core.status) {
    case "thinking":
      label = t("status.thinking");
      break;
    case "streaming":
      label = t("status.streaming");
      break;
    case "tool":
      label = core.activeTool ? t("status.toolNamed", { name: core.activeTool }) : t("status.tool");
      break;
    case "error":
      label = t("status.error");
      break;
    case "done":
      label = t("status.done");
      break;
    default:
      label = t("status.idle");
  }
  let s = `${theme.fg(color, glyph)} ${theme.fg(core.status === "idle" ? "dim" : color, label)}`;
  if (core.warning) s += theme.fg("warning", ` · ${t(`warnShort.${core.warning}`)}`);
  return s;
}

/** `omp-hud · ⠋ thinking · turn 3` */
function titleChip(state: HudState, theme: HudTheme): string {
  const sep = theme.fg("dim", " · ");
  let s = theme.bold(theme.fg("accent", "omp-hud")) + sep + statusChip(state, theme);
  if (state.core.turn > 0) s += sep + theme.fg("muted", t("turn", { n: state.core.turn }));
  return s;
}

/** `3 running · 2 done · 1 failed` (only the non-zero parts), then `3 running` alone; empty when there are no nodes. Longest first. */
function nodeCounts(state: HudState, theme: HudTheme): string[] {
  let running = 0;
  let done = 0;
  let failed = 0;
  for (const n of state.nodes) {
    if (n.status === "running") running++;
    else if (n.status === "completed") done++;
    else if (n.status === "failed") failed++;
  }
  const parts: string[] = [];
  if (running) parts.push(theme.fg("accent", `${running} ${t("node.running")}`));
  if (done) parts.push(theme.fg("success", `${done} ${t("node.completed")}`));
  if (failed) parts.push(theme.fg("error", `${failed} ${t("node.failed")}`));
  const variants = [parts.join(theme.fg("dim", " · "))];
  if (running && parts.length > 1) variants.push(parts[0]!);
  return variants;
}

/** One full-width row: `── left ─────── right ──`. The first `rights` variant that fits is used (none: no right part). Exactly `width` cells. */
function ruleRow(left: string, rights: readonly string[], width: number, theme: HudTheme): string {
  if (width <= 0) return "";
  if (width < 8) return rule(width, theme);
  const l = trunc(left, width - 4);
  const lw = vw(l);
  for (const right of rights) {
    const rw = vw(right);
    if (rw > 0 && width - lw - rw - 8 >= 2) {
      return `${rule(2, theme)} ${l} ${rule(width - lw - rw - 8, theme)} ${right} ${rule(2, theme)}`;
    }
  }
  return `${rule(2, theme)} ${l} ${rule(width - lw - 4, theme)}`;
}

/** `TASKS 3/7 ━━━──── ◐ active task` */
function tasksRow(state: HudState, width: number, theme: HudTheme): string {
  const head = tasksHeader(state, width, theme);
  const tasks = state.tasks;
  let tail: string;
  if (tasks.length === 0) tail = theme.fg("dim", dt("dock.noTasks"));
  else {
    const active = tasks.find((x) => x.status === "in_progress");
    if (active) tail = `${theme.fg("accent", taskSpinner(state.phase))} ${theme.bold(theme.fg("text", active.content))}`;
    else {
      const next = tasks.find((x) => x.status === "pending" || x.status === "blocked");
      if (next) {
        const mark = next.status === "blocked" ? theme.fg("warning", "⏸") : theme.fg("dim", "○");
        const label = next.status === "blocked" ? dt("dock.blocked") : dt("dock.nextTask");
        tail = `${mark} ${theme.fg("muted", label + ":")} ${theme.fg("text", next.content)}`;
      } else tail = `${theme.fg("success", "●")} ${theme.fg("success", dt("dock.allDone"))}`;
    }
  }
  return trunc(`${head} ${tail}`, width);
}

/** `in 12k out 3k · $0.42 · 38 tok/s · ctx ▇▇░ 42%`; tok/s and then the cost are dropped when the row is short. */
function tokensRow(state: HudState, width: number, theme: HudTheme): string {
  const tk = state.tokens;
  const sep = theme.fg("dim", " · ");
  const io = `${theme.fg("muted", t("tok.in"))} ${theme.fg("text", fmtNum(tk.input, true))} ${theme.fg("muted", t("tok.out"))} ${theme.fg("text", fmtNum(tk.output, true))}`;
  const cost = theme.fg("warning", fmtCost(tk.cost));
  const rate = `${theme.fg("text", String(tk.tokPerSec > 0 ? Math.round(tk.tokPerSec) : 0))} ${theme.fg("muted", "tok/s")}`;
  const label = theme.fg("muted", dt("dock.ctx"));
  const cells = width >= 56 ? 6 : 3;
  let ctx: string;
  if (tk.ctxPct === null || !Number.isFinite(tk.ctxPct)) ctx = `${label} ${theme.fg("dim", "–")}`;
  else {
    const p = Math.min(100, Math.max(0, tk.ctxPct));
    ctx = `${label} ${ctxBar(p, cells, theme)} ${theme.fg(p < 60 ? "success" : p < 85 ? "warning" : "error", `${Math.round(p)}%`)}`;
  }
  const variants = [[io, cost, rate, ctx], [io, cost, ctx], [io, ctx], [ctx]];
  for (const v of variants) {
    const s = v.join(sep);
    if (vw(s) <= width) return s;
  }
  return trunc(ctx, width);
}

/** The last `rows` feed rows (newest at the bottom); an empty feed shows a dim hint on the last row. */
function feedTail(state: HudState, width: number, rows: number, theme: HudTheme): string[] {
  if (rows <= 0) return [];
  if (state.feed.length === 0) {
    const out: string[] = [];
    for (let i = 0; i < rows - 1; i++) out.push("");
    out.push(trunc(theme.fg("dim", dt("dock.waiting")), width));
    return out;
  }
  return renderFeed(state, width, rows + 1, theme).slice(1);
}

function renderWide(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  const body = height - 1;
  const wide = width >= WIDE_WIDTH && height >= WIDE_HEIGHT;
  const orbitW = wide ? Math.min(30, Math.max(26, 2 * height + 8)) : 22;
  const rightW = width - orbitW - ORBIT_GAP;
  // The orbit uses every dock row (a bigger scene reads better); the rule + title sit on top of the right block only.
  const orbit = renderOrbitScene(state, orbitW, height, theme, { small: true });
  const gap = " ".repeat(ORBIT_GAP);

  const right = [ruleRow(titleChip(state, theme), nodeCounts(state, theme), rightW, theme)];
  for (const row of feedTail(state, rightW, body - 2, theme)) right.push(row);
  right.push(tasksRow(state, rightW, theme));
  right.push(tokensRow(state, rightW, theme));

  const out: string[] = [];
  for (let i = 0; i < height; i++) out.push(`${orbit[i] ?? " ".repeat(orbitW)}${gap}${right[i] ?? ""}`);
  return out;
}

function renderNarrow(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  const body = height - 1;
  const out: string[] = [ruleRow(theme.bold(theme.fg("accent", "omp-hud")), [], width, theme)];
  if (body <= 0) return out;
  const compact = renderCompact(state, width, theme);
  // Keep at least one feed row; the compact rows beyond that are dropped from the bottom (usage first).
  const compactRows = Math.min(compact.length, Math.max(1, body - 1));
  for (let i = 0; i < compactRows; i++) out.push(compact[i]!);
  for (const row of feedTail(state, width, body - compactRows, theme)) out.push(row);
  return out;
}

/**
 * Exactly `height` rows, each at most `width` cells wide (the top rule row is exactly `width`).
 * Height is expected in 4..14 but any positive height works.
 */
export function renderDock(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  width = Math.floor(width);
  height = Math.floor(height);
  if (!(height > 0)) return [];
  if (!(width > 0)) return new Array<string>(height).fill("");
  const out = width >= ORBIT_MIN_WIDTH && height >= ORBIT_MIN_HEIGHT ? renderWide(state, width, height, theme) : renderNarrow(state, width, height, theme);
  while (out.length < height) out.push("");
  return out.length > height ? out.slice(0, height) : out;
}
