// TASKS panel: phase headers, status glyphs; the active task is always visible.
import type { HudState, HudTask, HudTheme } from "../types.ts";
import { t } from "../i18n.ts";
import { trunc, vw } from "../util/text.ts";
import { taskSpinner } from "./fmt.ts";

/** Panel header (single line): `TASKS 3/7 ━━━───`. */
export function tasksHeader(state: HudState, width: number, theme: HudTheme): string {
  const total = state.tasks.length;
  let done = 0;
  for (const task of state.tasks) if (task.status === "completed") done++;
  const label = `${t("tasks.title")} ${done}/${total}`;
  let head = theme.bold(theme.fg("accent", label));
  const barW = Math.min(10, width - vw(label) - 1);
  if (total > 0 && barW >= 4) {
    const filled = Math.round((done / total) * barW);
    head += " " + theme.fg("success", "━".repeat(filled)) + theme.fg("dim", "─".repeat(barW - filled));
  }
  return head;
}

interface Line {
  text: string;
  task: boolean; // a task row (not a phase header)
}

function taskLine(task: HudTask, state: HudState, theme: HudTheme): string {
  switch (task.status) {
    case "in_progress":
      return `  ${theme.fg("accent", taskSpinner(state.phase))} ${theme.bold(theme.fg("text", task.content))}`;
    case "completed":
      return `  ${theme.fg("success", "●")} ${theme.fg("muted", task.content)}`;
    case "abandoned":
      return `  ${theme.fg("dim", "✗")} ${theme.fg("dim", task.content)}`;
    case "blocked":
      return (
        `  ${theme.fg("warning", "⏸")} ${theme.fg("text", task.content)}` +
        (task.blocker ? theme.fg("dim", ` — ${task.blocker}`) : "")
      );
    default:
      return `  ${theme.fg("dim", "○")} ${theme.fg("dim", task.content)}`;
  }
}

/** Exactly `height` rows: first row is the header, the rest are phases+tasks (scrolls so the active task stays visible). */
export function renderTasks(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  if (height <= 0 || width <= 0) return [];
  const out: string[] = [trunc(tasksHeader(state, width, theme), width)];
  const bodyH = height - 1;
  if (bodyH <= 0) return out;

  if (state.tasks.length === 0) {
    out.push(theme.fg("dim", t("tasks.empty")));
    while (out.length < height) out.push("");
    return out;
  }

  // Phase order follows first appearance; tasks without a phase are grouped without a header.
  const lines: Line[] = [];
  let activeIdx = -1;
  let firstPending = -1;
  let lastPhase: string | undefined;
  for (const task of state.tasks) {
    if (task.phase && task.phase !== lastPhase) {
      lines.push({ text: theme.fg("muted", `▾ ${task.phase}`), task: false });
      lastPhase = task.phase;
    }
    if (activeIdx < 0 && task.status === "in_progress") activeIdx = lines.length;
    if (firstPending < 0 && (task.status === "pending" || task.status === "blocked")) firstPending = lines.length;
    lines.push({ text: taskLine(task, state, theme), task: true });
  }
  const focus = activeIdx >= 0 ? activeIdx : firstPending;

  let start = 0;
  let cap = bodyH;
  let hidden = 0;
  if (lines.length > bodyH) {
    cap = bodyH >= 2 ? bodyH - 1 : 1; // last row is for `+N more`
    const f = focus >= 0 ? focus : 0;
    start = Math.min(Math.max(0, f - Math.floor(cap / 3)), lines.length - cap);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.task && (i < start || i >= start + cap)) hidden++;
    }
  }

  const win = lines.slice(start, start + cap);
  for (const l of win) out.push(trunc(l.text, width));
  if (hidden > 0 && bodyH >= 2) {
    while (out.length < height - 1) out.push("");
    out.push(theme.fg("dim", t("tasks.more", { n: hidden })));
  }
  while (out.length < height) out.push("");
  return out;
}
