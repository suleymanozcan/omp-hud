// Dock: the HUD as a short panel above the editor (4-16 rows). Pure render; no frame, only a thin rule on top.
//   wide   (width >= 70, height >= 6): elliptic orbit scene on the left (38% of the width, 28-72 columns), the rest on the right:
//            rule + feed + tasks + tokens; from 96 right-hand columns on the right block splits into a feed column and a
//            tasks/tokens column
//   narrow (otherwise)                : compact status rows + the tail of the live feed
import type { HudState, HudTask, HudTheme, HudTokens } from "../types.ts";
import { dt } from "../dock-i18n.ts";
import { agentLabel, t } from "../i18n.ts";
import { padEnd, trunc, vw } from "../util/text.ts";
import { compactIsAnimated, renderCompact } from "./compact.ts";
import { KIND_ICON } from "./feed.ts";
import { agentTag, coreColor, fmtClock, fmtCost, fmtNum, spinnerFor, taskSpinner } from "./fmt.ts";
import { renderOrbitScene } from "./orbit-scene.ts";
import { tasksHeader } from "./tasks.ts";
import { ctxBar } from "./tokens.ts";

export const DOCK_MIN_HEIGHT = 4;
export const DOCK_MAX_HEIGHT = 16;
/** Orbit scene is drawn when the dock is at least this wide and tall. */
const ORBIT_MIN_WIDTH = 70;
const ORBIT_MIN_HEIGHT = 6;
/** The orbit area takes this share of the dock width, clamped to 28-72 columns. */
const ORBIT_SHARE = 0.38;
const ORBIT_COLS_MIN = 28;
const ORBIT_COLS_MAX = 72;
const ORBIT_GAP = 2;
/** The right block splits into feed | tasks+tokens columns from this width and height. */
const TWO_COL_MIN_WIDTH = 96;
const TWO_COL_MIN_HEIGHT = 8;
const TOKEN_ROWS = 3;
/** The dock keeps animating for a moment after a status change / node end (flash, done pulse, end ripple). */
const STATUS_FX_MS = 3000;
const NODE_FX_MS = 1000;
/** A calm dock shows at most this many feed rows when there are tasks to show below them. */
const CALM_FEED_ROWS = 5;

/**
 * Whether the dock output depends on the animation phase right now (drives the frame bucket of the cache).
 * An idle core is animated too: it breathes and the placeholder sparkles orbit (at a lower frame rate, see `dockFps`).
 */
export function dockIsAnimated(state: HudState): boolean {
  if (compactIsAnimated(state) || state.core.warning || state.core.status === "idle") return true;
  const now = state.now;
  if (now - state.core.statusSince < STATUS_FX_MS) return true;
  for (const n of state.nodes) if (n.endedAt !== undefined && now - n.endedAt < NODE_FX_MS) return true;
  return false;
}

/** Frame bucket rate: 8 per second while something happens, 4 while the core only rests. */
export function dockFps(state: HudState): number {
  return compactIsAnimated(state) || state.core.warning || state.core.status !== "idle" ? 8 : 4;
}

/** Nothing is running: no working core and no running node (done keeps its green glow). */
function isCalm(state: HudState): boolean {
  const s = state.core.status;
  if (s !== "idle" && s !== "done") return false;
  for (const n of state.nodes) if (n.status === "running") return false;
  return true;
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

// ---------------------------------------------------------------- tasks

/** Tasks that still matter, in the order they are shown: active first, then pending, then blocked (the list order is kept inside a group). */
function openTasks(state: HudState): HudTask[] {
  const active: HudTask[] = [];
  const pending: HudTask[] = [];
  const blocked: HudTask[] = [];
  for (const task of state.tasks) {
    if (task.status === "in_progress") active.push(task);
    else if (task.status === "pending") pending.push(task);
    else if (task.status === "blocked") blocked.push(task);
  }
  return [...active, ...pending, ...blocked];
}

function taskMark(task: HudTask, state: HudState, theme: HudTheme): string {
  if (task.status === "in_progress") return theme.fg("accent", taskSpinner(state.phase));
  if (task.status === "blocked") return theme.fg("warning", "⏸");
  return theme.fg("dim", "○");
}

/** `TASKS 3/7 ━━━──── ◐ active task`: the active task, else the first pending one, else a blocked one; blocked ones come last. */
function tasksRow(state: HudState, width: number, theme: HudTheme): string {
  const head = tasksHeader(state, width, theme);
  let tail: string;
  if (state.tasks.length === 0) tail = theme.fg("dim", dt("dock.noTasks"));
  else {
    const first = openTasks(state)[0];
    if (!first) tail = `${theme.fg("success", "●")} ${theme.fg("success", dt("dock.allDone"))}`;
    else if (first.status === "in_progress") tail = `${taskMark(first, state, theme)} ${theme.bold(theme.fg("text", first.content))}`;
    else {
      const label = first.status === "blocked" ? dt("dock.blocked") : dt("dock.nextTask");
      tail = `${taskMark(first, state, theme)} ${theme.fg("muted", label + ":")} ${theme.fg("text", first.content)}`;
    }
  }
  return trunc(`${head} ${tail}`, width);
}

/** Task header for the tasks column: `TASKS 3/7 ━━━──── · 2 blocked`. */
function tasksColumnHeader(state: HudState, width: number, theme: HudTheme): string {
  let blocked = 0;
  for (const task of state.tasks) if (task.status === "blocked") blocked++;
  const extra = blocked > 0 ? theme.fg("warning", ` · ${dt("dock.blockedN", { n: blocked })}`) : "";
  return trunc(tasksHeader(state, width, theme) + extra, width);
}

/**
 * Up to `rows` task lines (the first `skip` open tasks are left out); `+N more` takes the last row when the list is longer.
 * `withDone` fills spare rows with the most recently finished tasks (dim).
 */
function taskLines(state: HudState, width: number, rows: number, theme: HudTheme, skip = 0, withDone = false): string[] {
  if (rows <= 0) return [];
  if (state.tasks.length === 0) return skip > 0 ? [] : [theme.fg("dim", dt("dock.noTasks"))];
  const open = openTasks(state);
  const out: string[] = [];
  if (open.length === 0 && skip === 0) out.push(`${theme.fg("success", "●")} ${theme.fg("success", dt("dock.allDone"))}`);
  const list = open.slice(skip);
  const room = list.length > rows && rows >= 2 ? rows - 1 : rows;
  for (const task of list.slice(0, room)) {
    const text = task.status === "in_progress" ? theme.bold(theme.fg("text", task.content)) : theme.fg(task.status === "blocked" ? "muted" : "text", task.content);
    out.push(trunc(`${taskMark(task, state, theme)} ${text}`, width));
  }
  if (list.length > room) out.push(theme.fg("dim", t("tasks.more", { n: list.length - room })));
  else if (withDone) {
    for (let i = state.tasks.length - 1; i >= 0 && out.length < rows; i--) {
      const task = state.tasks[i]!;
      if (task.status === "completed") out.push(trunc(`${theme.fg("success", "●")} ${theme.fg("dim", task.content)}`, width));
    }
  }
  return out;
}

// ---------------------------------------------------------------- tokens

function hasTokens(tk: HudTokens): boolean {
  return tk.input > 0 || tk.output > 0 || tk.cacheRead > 0 || tk.cacheWrite > 0 || tk.cost > 0;
}

function ctxSegment(tk: HudTokens, cells: number, theme: HudTheme): string {
  const label = theme.fg("muted", dt("dock.ctx"));
  if (tk.ctxPct === null || !Number.isFinite(tk.ctxPct)) return `${label} ${theme.fg("dim", "–")}`;
  const p = Math.min(100, Math.max(0, tk.ctxPct));
  return `${label} ${ctxBar(p, cells, theme)} ${theme.fg(p < 60 ? "success" : p < 85 ? "warning" : "error", `${Math.round(p)}%`)}`;
}

/** `in 12k out 3k · $0.42 · 38 tok/s · ctx ▇▇░ 42%`; `no tokens yet` replaces the zero counts; tok/s and then the cost are dropped when the row is short. */
function tokensRow(state: HudState, width: number, theme: HudTheme): string {
  const tk = state.tokens;
  const sep = theme.fg("dim", " · ");
  const io = hasTokens(tk)
    ? `${theme.fg("muted", t("tok.in"))} ${theme.fg("text", fmtNum(tk.input, true))} ${theme.fg("muted", t("tok.out"))} ${theme.fg("text", fmtNum(tk.output, true))}`
    : theme.fg("dim", dt("dock.noTokens"));
  const cost = theme.fg("warning", fmtCost(tk.cost));
  const rate = `${theme.fg("text", String(tk.tokPerSec > 0 ? Math.round(tk.tokPerSec) : 0))} ${theme.fg("muted", "tok/s")}`;
  const ctx = ctxSegment(tk, width >= 56 ? 6 : 3, theme);
  const variants = hasTokens(tk) ? [[io, cost, rate, ctx], [io, cost, ctx], [io, ctx], [ctx]] : [[io, ctx], [ctx]];
  for (const v of variants) {
    const s = v.join(sep);
    if (vw(s) <= width) return s;
  }
  return trunc(ctx, width);
}

/** Exactly TOKEN_ROWS rows for the tasks column: counts, cost + speed, context bar. */
function tokenLines(state: HudState, width: number, theme: HudTheme): string[] {
  const tk = state.tokens;
  const sep = theme.fg("dim", " · ");
  let counts: string;
  if (hasTokens(tk)) {
    const parts = [
      `${theme.fg("muted", t("tok.in"))} ${theme.fg("text", fmtNum(tk.input, true))}`,
      `${theme.fg("muted", t("tok.out"))} ${theme.fg("text", fmtNum(tk.output, true))}`,
    ];
    if (tk.cacheRead > 0 || tk.cacheWrite > 0) parts.push(`${theme.fg("muted", t("tok.cache"))} ${theme.fg("text", fmtNum(tk.cacheRead, true))}`);
    counts = parts.join(sep);
  } else counts = theme.fg("dim", dt("dock.noTokens"));
  const rate = `${theme.fg("text", String(tk.tokPerSec > 0 ? Math.round(tk.tokPerSec) : 0))} ${theme.fg("muted", "tok/s")}`;
  const cells = Math.min(16, Math.max(4, width - vw(dt("dock.ctx")) - 8));
  return [trunc(counts, width), trunc(`${theme.fg("warning", fmtCost(tk.cost))}${sep}${rate}`, width), trunc(ctxSegment(tk, cells, theme), width)];
}

// ---------------------------------------------------------------- feed

/** The last `rows` events, oldest first: `15:00:32 ▸ explore │ read src/x.ts`; time, icon and label are aligned columns. */
function feedRows(state: HudState, width: number, rows: number, theme: HudTheme): string[] {
  const feed = state.feed;
  const shown = feed.length > rows ? feed.slice(feed.length - rows) : feed;
  const showTime = width >= 34;
  const showBar = width >= 50;
  let labelW = 0;
  for (const it of shown) labelW = Math.max(labelW, vw(agentLabel(it.agent)));
  labelW = Math.min(Math.max(labelW, 6), width >= 60 ? 12 : 8);
  const out: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    const it = shown[i]!;
    const age = shown.length - 1 - i; // 0 = newest
    const tone = age < 3 ? "text" : "muted";
    const time = showTime ? `${theme.fg("dim", fmtClock(it.t))} ` : "";
    const icon = it.error ? theme.fg("error", "✗") : theme.fg(age < 3 ? "accent" : "muted", KIND_ICON[it.kind] ?? "○");
    const label = trunc(agentLabel(it.agent), labelW);
    const tag = padEnd(agentTag(theme, it.agent, label), labelW);
    const bar = showBar ? `${theme.fg("dim", "│")} ` : "";
    const text = theme.fg(it.error ? "error" : tone, it.text.replace(/\s+/g, " "));
    out.push(trunc(`${time}${icon} ${tag} ${bar}${text}`, width));
  }
  return out;
}

/** What an empty feed shows: the waiting line and a tip (more tip lines when there is room). Top-aligned. */
function emptyFeedRows(width: number, rows: number, theme: HudTheme): string[] {
  const out = [trunc(`${theme.fg("dim", "○")} ${theme.fg("dim", dt("dock.waiting"))}`, width)];
  const cmd = (s: string): string => theme.fg("accent", s);
  const dot = theme.fg("dim", " · ");
  if (rows >= 3) out.push("");
  if (rows >= 2) out.push(trunc(`${theme.fg("muted", dt("dock.tip"))}  ${cmd("/hud demo")}${dot}${cmd("/hud size")}${dot}${cmd("/hud help")}`, width));
  const details: [string, string][] = [
    ["/hud demo", dt("dock.tipDemo")],
    ["/hud size", dt("dock.tipSize")],
    ["/hud help", dt("dock.tipHelp")],
  ];
  if (rows - out.length >= details.length) {
    for (const [c, d] of details) out.push(trunc(`  ${cmd(padEnd(c, 10))} ${theme.fg("dim", d)}`, width));
  }
  return out;
}

/** Exactly `rows` rows, filled from the top (older events scroll off the top once the area is full). */
function feedLines(state: HudState, width: number, rows: number, theme: HudTheme): string[] {
  if (rows <= 0) return [];
  const out = state.feed.length === 0 ? emptyFeedRows(width, rows, theme) : feedRows(state, width, rows, theme);
  while (out.length < rows) out.push("");
  return out;
}

/** Calm single-column middle: a few events, then the open tasks after the one already shown on the tasks row. */
function calmLines(state: HudState, width: number, rows: number, theme: HudTheme): string[] {
  const rest = openTasks(state).length - 1;
  if (rest <= 0 || rows < 3) return feedLines(state, width, rows, theme);
  const feedN = state.feed.length;
  const feedRowsN = feedN > 0 ? Math.min(feedN, CALM_FEED_ROWS, rows - 1) : Math.min(2, rows - 1);
  const out = feedLines(state, width, feedRowsN, theme);
  for (const line of taskLines(state, width, rows - feedRowsN, theme, 1)) out.push(line);
  while (out.length < rows) out.push("");
  return out;
}

// ---------------------------------------------------------------- layouts

/** The right block: exactly `height` rows (title rule + body). */
function renderRight(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  const body = height - 1;
  const out = [ruleRow(titleChip(state, theme), nodeCounts(state, theme), width, theme)];
  if (width >= TWO_COL_MIN_WIDTH && height >= TWO_COL_MIN_HEIGHT) {
    const feedW = Math.min(80, Math.round(width * 0.58));
    const infoW = width - feedW - 3;
    const feed = feedLines(state, feedW, body, theme);
    const info = [tasksColumnHeader(state, infoW, theme), ...taskLines(state, infoW, body - 1 - TOKEN_ROWS, theme, 0, true)];
    while (info.length < body - TOKEN_ROWS) info.push("");
    for (const line of tokenLines(state, infoW, theme)) info.push(line);
    const bar = theme.fg("dim", " │ ");
    for (let i = 0; i < body; i++) out.push(`${padEnd(feed[i] ?? "", feedW)}${bar}${info[i] ?? ""}`);
    return out;
  }
  const mid = isCalm(state) ? calmLines(state, width, body - 2, theme) : feedLines(state, width, body - 2, theme);
  for (const row of mid) out.push(row);
  out.push(tasksRow(state, width, theme));
  out.push(tokensRow(state, width, theme));
  return out;
}

function renderWide(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  const orbitW = Math.min(ORBIT_COLS_MAX, Math.max(ORBIT_COLS_MIN, Math.round(width * ORBIT_SHARE)));
  // The orbit uses every dock row (a bigger scene reads better); the rule + title sit on top of the right block only.
  const orbit = renderOrbitScene(state, orbitW, height, theme, { small: true, wide: true });
  const right = renderRight(state, width - orbitW - ORBIT_GAP, height, theme);
  const gap = " ".repeat(ORBIT_GAP);
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
  for (const row of feedLines(state, width, body - compactRows, theme)) out.push(row);
  return out;
}

/**
 * Exactly `height` rows, each at most `width` cells wide (the top rule row is exactly `width`).
 * Height is expected in 4..16 but any positive height works.
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
