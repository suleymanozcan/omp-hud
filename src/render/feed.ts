// LIVE FEED panel: latest events, newest at the bottom.
import type { FeedKind, HudState, HudTheme } from "../types.ts";
import { agentLabel, t } from "../i18n.ts";
import { trunc, vw } from "../util/text.ts";
import { agentTag, fmtClock } from "./fmt.ts";

const KIND_ICON: Record<FeedKind, string> = {
  tool: "▸",
  message: "·",
  subagent: "◆",
  retry: "⟳",
  error: "✗",
  todo: "☰",
  system: "○",
};

const BRIGHT_ROWS = 3; // the newest rows are bright
const MUTED_ROWS = 8; // the next ones are muted; older ones are dim

/** Panel header (single line): `LIVE FEED · N`. */
export function feedHeader(state: HudState, theme: HudTheme): string {
  return theme.bold(theme.fg("accent", t("feed.title"))) + theme.fg("muted", ` · ${state.feed.length}`);
}

/** Exactly `height` rows: first row is the header, the rest are events (newest at the bottom). */
export function renderFeed(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  if (height <= 0 || width <= 0) return [];
  const out: string[] = [trunc(feedHeader(state, theme), width)];
  const bodyH = height - 1;
  if (bodyH <= 0) return out;

  const feed = state.feed;
  const shown = feed.length > bodyH ? feed.slice(feed.length - bodyH) : feed;

  const showTime = width >= 36;
  let labelW = 0;
  for (const it of shown) labelW = Math.max(labelW, vw(agentLabel(it.agent)));
  labelW = Math.min(labelW, width >= 60 ? 12 : 8);

  const rows: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    const it = shown[i]!;
    const age = shown.length - 1 - i; // 0 = newest
    const tone = age < BRIGHT_ROWS ? "text" : age < MUTED_ROWS ? "muted" : "dim";
    const time = showTime ? theme.fg("dim", fmtClock(it.t)) + " " : "";
    const icon = it.error ? theme.fg("error", "✗") : theme.fg(age < MUTED_ROWS ? "muted" : "dim", KIND_ICON[it.kind] ?? "○");
    const label = trunc(agentLabel(it.agent), labelW);
    const tag = agentTag(theme, it.agent, label) + " ".repeat(Math.max(0, labelW - vw(label)));
    const textColor = it.error ? "error" : tone;
    const text = theme.fg(textColor, it.text.replace(/\s+/g, " "));
    rows.push(trunc(`${time}${icon} ${tag} ${text}`, width));
  }

  for (let i = shown.length; i < bodyH; i++) out.push("");
  if (shown.length === 0) {
    out[1] = theme.fg("dim", t("feed.empty"));
    return out;
  }
  for (const r of rows) out.push(r);
  return out;
}
