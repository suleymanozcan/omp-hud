// Token / cost / context gauges (1-3 rows).
import type { HudState, HudTheme } from "../types.ts";
import { t } from "../i18n.ts";
import { trunc, vw } from "../util/text.ts";
import { fmtCost, fmtNum } from "./fmt.ts";

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPARK_LEN = 16;

/** Short sparkline; `history` holds tok/s samples, oldest first. */
export function sparkline(history: readonly number[], len: number, theme: HudTheme): string {
  const data = history.length > len ? history.slice(history.length - len) : history;
  let max = 1;
  for (const v of data) if (v > max) max = v;
  let s = "";
  for (const v of data) s += SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round((v / max) * (SPARK.length - 1))))]!;
  const pad = len - data.length;
  return (pad > 0 ? theme.fg("dim", "▁".repeat(pad)) : "") + theme.fg("accent", s);
}

/** Context gauge: `▇▇▇▇░░░░`; color thresholds: green <60, warning <85, error >=85. */
export function ctxBar(pct: number, cells: number, theme: HudTheme): string {
  const p = Math.min(100, Math.max(0, pct));
  const filled = Math.min(cells, Math.round((p / 100) * cells));
  const color = p < 60 ? "success" : p < 85 ? "warning" : "error";
  return theme.fg(color, "▇".repeat(filled)) + theme.fg("dim", "░".repeat(cells - filled));
}

/** `context ▇▇▇▇░░░░ 42%` or `context –`. */
export function ctxSegment(ctxPct: number | null, cells: number, theme: HudTheme): string {
  const label = theme.fg("muted", t("tok.ctx"));
  if (ctxPct === null || !Number.isFinite(ctxPct)) return `${label} ${theme.fg("dim", "–")}`;
  const p = Math.min(100, Math.max(0, ctxPct));
  const color = p < 60 ? "success" : p < 85 ? "warning" : "error";
  return `${label} ${ctxBar(p, cells, theme)} ${theme.fg(color, Math.round(p) + "%")}`;
}

/**
 * `in 12.3k  out 3.4k  cache 8.1k/0.9k  $0.42  38 tok/s` + context gauge.
 * Segments share a row while they fit; the ones that do not fit wrap to the next row (at most 3 rows).
 */
export function renderTokens(state: HudState, width: number, theme: HudTheme, history?: readonly number[]): string[] {
  if (width <= 0) return [];
  const tk = state.tokens;
  const k = (label: string, value: string): string => `${theme.fg("muted", label)} ${theme.fg("text", value)}`;

  const counts = [
    k(t("tok.in"), fmtNum(tk.input)),
    k(t("tok.out"), fmtNum(tk.output)),
    `${theme.fg("muted", t("tok.cache"))} ${theme.fg("text", fmtNum(tk.cacheRead))}${theme.fg("dim", "/")}${theme.fg("text", fmtNum(tk.cacheWrite))}`,
    theme.fg("warning", fmtCost(tk.cost)),
  ].join("  ");

  const rate = String(tk.tokPerSec > 0 ? Math.round(tk.tokPerSec) : 0);
  let speed = `${theme.fg("text", rate)} ${theme.fg("muted", "tok/s")}`;
  if (history && history.length > 0) speed += " " + sparkline(history, width >= 60 ? SPARK_LEN : 8, theme);

  const ctx = ctxSegment(tk.ctxPct, width >= 70 ? 10 : 8, theme);

  const lines: string[] = [];
  let cur = "";
  for (const seg of [counts, speed, ctx]) {
    if (cur === "") cur = seg;
    else if (vw(cur) + 3 + vw(seg) <= width) cur += theme.fg("dim", " · ") + seg;
    else {
      lines.push(trunc(cur, width));
      cur = seg;
    }
  }
  if (cur !== "") lines.push(trunc(cur, width));
  return lines;
}
