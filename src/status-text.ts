// Plain-text one-line HUD summary for the omp status bar (ctx.ui.setStatus). No ANSI: omp strips escape
// sequences from hook status text anyway. Reuses the catalog labels; independent of the compact renderer.
import type { HudNode, HudState } from "./types.ts";
import { t } from "./i18n.ts";
import { coreLabel, fmtNum } from "./render/fmt.ts";
import { trunc, vw } from "./util/text.ts";

/** Hard cap on the visible width of the status line. */
export const STATUS_MAX_COLS = 100;

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function glyph(state: HudState, frame: number): string {
  switch (state.core.status) {
    case "thinking":
    case "streaming":
    case "tool":
      return SPIN[Math.abs(frame) % SPIN.length]!;
    case "error":
      return "✗";
    case "done":
      return "✓";
    default:
      return "○";
  }
}

/** Node counts like `2 running 1 done`; empty when there are no nodes. */
export function nodeCounts(nodes: readonly HudNode[]): string {
  let running = 0;
  let done = 0;
  let failed = 0;
  let aborted = 0;
  for (const n of nodes) {
    if (n.status === "running") running++;
    else if (n.status === "completed") done++;
    else if (n.status === "failed") failed++;
    else aborted++;
  }
  const parts: string[] = [];
  if (running) parts.push(`${running} ${t("node.running")}`);
  if (done) parts.push(`${done} ${t("node.completed")}`);
  if (failed) parts.push(`${failed} ${t("node.failed")}`);
  if (aborted) parts.push(`${aborted} ${t("node.aborted")}`);
  return parts.join(" ");
}

/** True while the glyph animates (the status line needs periodic refreshes). */
export function statusIsAnimated(state: HudState): boolean {
  const s = state.core.status;
  if (s === "thinking" || s === "streaming" || s === "tool") return true;
  return state.nodes.some((n) => n.status === "running");
}

/**
 * One line: `hud <glyph> <status>[ · <node counts>][ · in X out Y][ · ctx N%]`.
 * `frame` drives the spinner; `maxCols` caps the width (optional parts are dropped first, then truncated).
 */
export function statusLineText(state: HudState, frame: number, maxCols: number = STATUS_MAX_COLS): string {
  const cap = Math.max(8, Math.min(STATUS_MAX_COLS, Math.floor(maxCols)));
  const { core, tokens: tk } = state;
  let head = `hud ${glyph(state, frame)} ${coreLabel(core.status, core.activeTool)}`;
  if (core.warning) head += ` · ${t(`warnShort.${core.warning}`)}`;

  const nodes = state.nodes.length > 0 ? nodeCounts(state.nodes) : "";
  const io = tk.input > 0 || tk.output > 0 ? `${t("tok.in")} ${fmtNum(tk.input, true)} ${t("tok.out")} ${fmtNum(tk.output, true)}` : "";
  const ctx = tk.ctxPct !== null ? `${t("status.ctx")} ${Math.round(tk.ctxPct)}%` : "";

  // Drop the least important parts first: io, then ctx, then the node counts.
  const variants = [
    [head, nodes, io, ctx],
    [head, nodes, ctx],
    [head, nodes],
    [head],
  ].map((v) => v.filter((p) => p !== "").join(" · "));
  for (const v of variants) if (vw(v) <= cap) return v;
  return trunc(head, cap);
}
