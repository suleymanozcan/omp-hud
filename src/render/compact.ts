// Compact HUD for belowEditor: at most 3 rows.
import type { HudNode, HudState, HudTheme } from "../types.ts";
import { trunc, vw } from "../util/text.ts";
import { t } from "../i18n.ts";
import { coreColor, coreLabel, fmtCost, fmtNum, spinnerFor } from "./fmt.ts";
import { ctxSegment } from "./tokens.ts";

/** Whether the compact view depends on animation (for the cache bucket). */
export function compactIsAnimated(state: HudState): boolean {
  const s = state.core.status;
  if (s === "thinking" || s === "streaming" || s === "tool") return true;
  for (const n of state.nodes) if (n.status === "running") return true;
  return false;
}

function statusLine(state: HudState, theme: HudTheme): string {
  const { core } = state;
  const color = coreColor(core.status);
  let glyph: string;
  if (core.status === "thinking" || core.status === "streaming" || core.status === "tool") {
    glyph = spinnerFor(core.status, state.phase);
  } else if (core.status === "error") glyph = "✗";
  else if (core.status === "done") glyph = "✓";
  else glyph = "○";

  let line = `${theme.fg(color, glyph)} ${theme.fg(core.status === "idle" ? "dim" : color, coreLabel(core.status, core.activeTool))}`;
  if (core.warning) line += theme.fg("warning", ` · ${t(`warnShort.${core.warning}`)}`);
  if (core.turn > 0) line += theme.fg("dim", ` · ${t("turn", { n: core.turn })}`);
  return line;
}

function dotFor(n: HudNode, phase: number, theme: HudTheme): string {
  switch (n.status) {
    case "running":
      return Math.sin(phase * 5) > 0 ? theme.fg("accent", "●") : theme.fg("muted", "●");
    case "completed":
      return theme.fg("success", "●");
    case "failed":
      return theme.fg("error", "●");
    default:
      return theme.fg("dim", "○");
  }
}

function nodesLine(state: HudState, width: number, theme: HudTheme): string {
  const nodes = state.nodes;
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
  if (running) parts.push(theme.fg("accent", `${running} ${t("node.running")}`));
  if (done) parts.push(theme.fg("success", `${done} ${t("node.completed")}`));
  if (failed) parts.push(theme.fg("error", `${failed} ${t("node.failed")}`));
  if (aborted) parts.push(theme.fg("dim", `${aborted} ${t("node.aborted")}`));
  let summary = parts.join(theme.fg("dim", " · "));

  const minDots = Math.min(nodes.length, 3);
  let cap = Math.floor((width - vw(summary) - 1) / 2);
  if (cap < minDots) {
    summary = "";
    cap = Math.floor(width / 2);
  }

  // When it does not fit, running nodes are shown first and the rest becomes `+N`.
  let shown: HudNode[] = nodes;
  let more = 0;
  if (nodes.length > cap) {
    const room = Math.max(1, cap - 2); // room for `+N`
    const order = [...nodes.filter((n) => n.status === "running"), ...nodes.filter((n) => n.status !== "running")];
    shown = order.slice(0, room);
    more = nodes.length - shown.length;
  }
  let line = shown.map((n) => dotFor(n, state.phase, theme)).join(" ");
  if (more > 0) line += " " + theme.fg("muted", `+${more}`);
  if (summary !== "") line += "  " + summary;
  return line;
}

function usageLine(state: HudState, width: number, theme: HudTheme): string {
  const tk = state.tokens;
  const sep = theme.fg("dim", " · ");
  const io = `${theme.fg("muted", t("tok.in"))} ${theme.fg("text", fmtNum(tk.input, true))} ${theme.fg("muted", t("tok.out"))} ${theme.fg("text", fmtNum(tk.output, true))}`;
  const cost = theme.fg("warning", fmtCost(tk.cost));
  const speed = tk.tokPerSec > 0 ? `${theme.fg("text", String(Math.round(tk.tokPerSec)))} ${theme.fg("muted", "tok/s")}` : "";
  const ctx = ctxSegment(tk.ctxPct, 3, theme);

  // When it does not fit, tok/s is dropped first, then the cost.
  const variants = [
    [io, cost, speed, ctx],
    [io, cost, ctx],
    [io, ctx],
  ].map((v) => v.filter((p) => p !== ""));
  for (const v of variants) {
    const s = v.join(sep);
    if (vw(s) <= width) return s;
  }
  return variants[variants.length - 1]!.join(sep);
}

/** At most 3 rows; every row fits `width`. A single row when there are no nodes/events. */
export function renderCompact(state: HudState, width: number, theme: HudTheme): string[] {
  if (width <= 0) return [];
  const lines: string[] = [statusLine(state, theme)];
  if (state.nodes.length > 0) lines.push(nodesLine(state, width, theme));
  const tk = state.tokens;
  if (tk.input > 0 || tk.output > 0 || tk.cost > 0 || tk.ctxPct !== null) lines.push(usageLine(state, width, theme));
  return lines.map((l) => trunc(l, width));
}
