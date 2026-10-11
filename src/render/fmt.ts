// Shared formatting helpers for the panel renderers (pure, dependency-free).
import type { CoreStatus, HudTheme, NodeStatus } from "../types.ts";
import { MAIN_AGENT, t } from "../i18n.ts";

/** Human-readable number: 950, 1.2k, 12.3k, 123k, 3.4M. When `short` is true, values above 10k have no decimals (12k). */
export function fmtNum(n: number, short = false): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const unit = (v: number, suffix: string): string => {
    const dec = v >= 100 || (short && v >= 10) ? 0 : 1;
    const s = v.toFixed(dec);
    return (dec === 1 && s.endsWith(".0") ? s.slice(0, -2) : s) + suffix;
  };
  if (n < 999_500) return unit(n / 1000, "k");
  if (n < 999_500_000) return unit(n / 1_000_000, "M");
  return unit(n / 1_000_000_000, "G");
}

export function fmtCost(c: number): string {
  if (!Number.isFinite(c) || c <= 0) return "$0.00";
  if (c < 0.01) return "$" + c.toFixed(3);
  if (c < 100) return "$" + c.toFixed(2);
  return "$" + Math.round(c);
}

function p2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Local time HH:mm:ss. */
export function fmtClock(t: number): string {
  const d = new Date(t);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Duration: mm:ss (h:mm:ss once past an hour). */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${p2(m)}:${p2(s % 60)}` : `${p2(m)}:${p2(s % 60)}`;
}

const BRAILLE_THINK = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAILLE_STREAM = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const BRAILLE_TOOL = ["⠁", "⠉", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠤", "⠄", "⠄", "⠤", "⠠", "⠠", "⠤", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"];

/** Braille spinner that depends on the core status (phase: seconds). */
export function spinnerFor(status: CoreStatus, phase: number): string {
  const frames = status === "thinking" ? BRAILLE_THINK : status === "streaming" ? BRAILLE_STREAM : BRAILLE_TOOL;
  const rate = status === "thinking" ? 12 : status === "streaming" ? 14 : 10;
  return frames[Math.floor(Math.max(0, phase) * rate) % frames.length]!;
}

const QUARTERS = ["◐", "◓", "◑", "◒"];
/** Animated glyph for the active task. */
export function taskSpinner(phase: number): string {
  return QUARTERS[Math.floor(Math.max(0, phase) * 5) % QUARTERS.length]!;
}

type FgColor = Parameters<HudTheme["fg"]>[0];

export function coreLabel(status: CoreStatus, tool?: string): string {
  switch (status) {
    case "thinking":
      return t("status.thinking");
    case "streaming":
      return t("status.streaming");
    case "tool":
      return tool ? t("status.toolNamed", { name: tool }) : t("status.tool");
    case "error":
      return t("status.error");
    default:
      return t("status.idle");
  }
}

export function coreColor(status: CoreStatus): FgColor {
  switch (status) {
    case "thinking":
    case "streaming":
      return "accent";
    case "tool":
      return "warning";
    case "error":
      return "error";
    case "done":
      return "success";
    default:
      return "dim";
  }
}

export function nodeStatusLabel(s: NodeStatus): string {
  switch (s) {
    case "running":
      return t("node.running");
    case "completed":
      return t("node.completed");
    case "failed":
      return t("node.failed");
    default:
      return t("node.aborted");
  }
}

export function nodeStatusColor(s: NodeStatus): FgColor {
  switch (s) {
    case "running":
      return "accent";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "dim";
  }
}

const AGENT_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 170, 80],
  [170, 130, 255],
  [90, 210, 170],
  [255, 120, 160],
  [240, 220, 100],
  [110, 190, 255],
  [200, 160, 120],
  [150, 230, 110],
];
const AGENT_FALLBACK: readonly FgColor[] = ["warning", "success", "muted", "text"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Colors an agent label: the main agent uses accent; subagents get a stable name-based color. */
export function agentTag(theme: HudTheme, agent: string, text: string): string {
  if (agent === MAIN_AGENT) return theme.fg("accent", text);
  const h = hash(agent);
  if (theme.truecolor) {
    const c = AGENT_PALETTE[h % AGENT_PALETTE.length]!;
    return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${text}\x1b[39m`;
  }
  return theme.fg(AGENT_FALLBACK[h % AGENT_FALLBACK.length]!, text);
}
