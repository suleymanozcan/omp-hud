// Full-screen HUD layout: header, panels (orbit | conversation + thin feed + task summary), token strip, prompt box.
import type { HudNode, HudState, HudTheme } from "../types.ts";
import type { ChatView } from "../chat.ts";
import { ct } from "../chat-i18n.ts";
import { padEnd, trunc, vw } from "../util/text.ts";
import { t } from "../i18n.ts";
import { coreColor, coreLabel, fmtClock, fmtCost, fmtDur, fmtNum, nodeStatusColor, nodeStatusLabel, spinnerFor } from "./fmt.ts";
import { renderFeed } from "./feed.ts";
import { renderChat } from "./chat.ts";
import { renderTasks } from "./tasks.ts";
import { renderTokens } from "./tokens.ts";

export const MIN_WIDTH = 50;
export const MIN_HEIGHT = 14;
const PROMPT_H = 3; // rule + input row + hint row
const MIN_CHAT_H = 6; // frame rows the conversation always keeps

export type OrbitRenderer = (
  state: HudState,
  width: number,
  height: number,
  theme: HudTheme,
  options?: { selectedId?: string },
) => string[];

export interface ComposeOptions {
  selectedId?: string;
  detail?: boolean;
  orbit: OrbitRenderer;
  /** tok/s sparkline history (oldest first). */
  history?: readonly number[];
  /** Scroll state of the conversation panel (read and updated by the renderer). */
  chatView?: ChatView;
  /** The prompt row, already rendered by the input component (exactly `width` cells). */
  inputRow?: string;
  /** False while the prompt holds text (the hint changes). */
  inputEmpty?: boolean;
  /** A transient message (command output, warning) shown in place of the key hint. */
  flash?: { text: string; level: "info" | "warning" | "error" };
}

/** Thin-line frame; `title` is embedded in the top edge. Exactly `w` x `h` cells. */
function frame(title: string, body: readonly string[], w: number, h: number, theme: HudTheme): string[] {
  if (w < 2 || h < 2) return Array.from({ length: Math.max(0, h) }, () => " ".repeat(Math.max(0, w)));
  const edge = (s: string): string => theme.fg("dim", s);
  const inner = w - 2;
  const t = title !== "" && inner >= 6 ? trunc(title, inner - 3) : "";
  const top =
    t === ""
      ? edge("╭" + "─".repeat(inner) + "╮")
      : edge("╭─ ") + t + edge(" " + "─".repeat(Math.max(0, inner - 3 - vw(t) - 1)) + "╮");
  const out: string[] = [top];
  for (let i = 0; i < h - 2; i++) out.push(edge("│") + padEnd(body[i] ?? "", inner) + edge("│"));
  out.push(edge("╰" + "─".repeat(inner) + "╯"));
  return out;
}

/** Puts the output of a `render(width,height)` (first row is the title) into a frame. */
function panel(
  render: (innerW: number, innerH: number) => string[],
  w: number,
  h: number,
  theme: HudTheme,
): string[] {
  const lines = render(Math.max(0, w - 2), Math.max(0, h - 2) + 1);
  return frame(lines[0] ?? "", lines.slice(1), w, h, theme);
}

function wrapPlain(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  let cur = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (word === "") continue;
    if (cur !== "" && vw(cur) + 1 + vw(word) <= width) cur += " " + word;
    else {
      if (cur !== "") out.push(cur);
      cur = vw(word) > width ? trunc(word, width) : word;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

const DETAIL_LABELS = [
  "detail.name",
  "detail.status",
  "detail.model",
  "detail.duration",
  "detail.tokens",
  "detail.cost",
  "detail.ctxTokens",
  "detail.toolCount",
  "detail.currentTool",
  "detail.error",
] as const;

/** Node details: first line is the title, the rest are label: value rows. Exactly `height` rows. */
function renderDetail(node: HudNode, state: HudState, width: number, height: number, theme: HudTheme): string[] {
  if (height <= 0) return [];
  const out: string[] = [theme.bold(theme.fg("accent", t("detail.title"))) + theme.fg("muted", ` · ${node.name}`)];
  const labelW = Math.max(...DETAIL_LABELS.map((k) => vw(t(k)))) + 2;
  const row = (key: (typeof DETAIL_LABELS)[number], value: string): string => theme.fg("muted", t(key).padEnd(labelW)) + value;
  const txt = (s: string): string => theme.fg("text", s);
  const dur = fmtDur((node.endedAt ?? state.now) - node.startedAt);
  const tool = node.currentTool
    ? txt(node.currentTool) + (node.lastIntent ? theme.fg("dim", ` — ${node.lastIntent}`) : "")
    : node.lastIntent
      ? theme.fg("dim", node.lastIntent)
      : theme.fg("dim", "–");
  const rows: string[] = [
    row("detail.name", txt(node.name)),
    row("detail.status", theme.fg(nodeStatusColor(node.status), nodeStatusLabel(node.status) + (node.retrying ? ` · ${t("warnShort.retry")}` : ""))),
    row("detail.model", node.model ? txt(node.model) : theme.fg("dim", "–")),
    row("detail.duration", txt(dur)),
    row("detail.tokens", txt(fmtNum(node.tokens))),
    row("detail.cost", theme.fg("warning", fmtCost(node.cost))),
    row("detail.ctxTokens", node.contextTokens !== undefined ? txt(fmtNum(node.contextTokens)) : theme.fg("dim", "–")),
    row("detail.toolCount", txt(String(node.toolCount))),
    row("detail.currentTool", tool),
  ];
  const bodyH = height - 1;
  for (const r of rows) {
    if (out.length - 1 >= bodyH) break;
    out.push(trunc(r, width));
  }
  if (node.error) {
    const room = bodyH - (out.length - 1);
    if (room > 0) {
      const wrapped = wrapPlain(node.error, Math.max(1, width - labelW));
      for (let i = 0; i < wrapped.length && i < room; i++) {
        const last = i === room - 1 && wrapped.length > room;
        const piece = last ? trunc(wrapped[i]! + "…", width - labelW) : wrapped[i]!;
        out.push((i === 0 ? theme.fg("muted", t("detail.error").padEnd(labelW)) : " ".repeat(labelW)) + theme.fg("error", piece));
      }
    }
  }
  while (out.length < height) out.push("");
  return out;
}

function headerRow(state: HudState, width: number, theme: HudTheme): string {
  const { core } = state;
  const active = core.status === "thinking" || core.status === "streaming" || core.status === "tool";
  const glyph = active ? spinnerFor(core.status, state.phase) : core.status === "error" ? "✗" : core.status === "done" ? "✓" : "○";
  const color = coreColor(core.status);
  let left = ` ${theme.bold(theme.fg("accent", "OMP · HUD"))}  ${theme.fg(color, `${glyph} ${coreLabel(core.status, core.activeTool)}`)}`;
  if (core.turn > 0) left += theme.fg("dim", ` · ${t("turn", { n: core.turn })}`);
  const right = theme.fg("muted", fmtClock(state.now)) + " ";
  if (vw(left) + 1 + vw(right) > width) return padEnd(left, width);
  return left + " ".repeat(width - vw(left) - vw(right)) + right;
}

/** Prompt box: a thin rule, the input row (rendered by the owner) and the hint row (or a transient message). */
function promptBox(opts: ComposeOptions, width: number, theme: HudTheme): string[] {
  let hint: string;
  if (opts.flash) hint = theme.fg(opts.flash.level === "info" ? "muted" : opts.flash.level, opts.flash.text);
  else {
    const key = opts.detail && opts.selectedId
      ? "chat.hint.detail"
      : opts.selectedId
        ? "chat.hint.selected"
        : opts.inputEmpty === false
          ? "chat.hint.typing"
          : "chat.hint.base";
    hint = theme.fg("dim", ct(key));
  }
  return [theme.fg("dim", "─".repeat(width)), padEnd(opts.inputRow ?? "", width), padEnd(" " + hint, width)];
}

function tooSmall(width: number, height: number, theme: HudTheme): string[] {
  const msg = padEnd(` ${theme.fg("warning", t("tooSmall", { w: MIN_WIDTH, h: MIN_HEIGHT }))}`, Math.max(0, width));
  const out: string[] = [];
  const mid = Math.floor((height - 1) / 2);
  for (let i = 0; i < height; i++) out.push(i === mid ? msg : "");
  return out;
}

function joinColumns(left: readonly string[], right: readonly string[]): string[] {
  const n = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((left[i] ?? "") + (right[i] ?? ""));
  return out;
}

/** HUD of exactly `height` rows, every row exactly `width` cells. */
export function composeHud(state: HudState, width: number, height: number, theme: HudTheme, opts: ComposeOptions): string[] {
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return tooSmall(width, height, theme);

  const bodyH = height - 1 - PROMPT_H; // header above, prompt box below
  const selected = opts.selectedId !== undefined ? state.nodes.find((n) => n.id === opts.selectedId) : undefined;
  const showDetail = opts.detail === true && selected !== undefined;

  // Bottom strip: token panel
  const tokenLines = renderTokens(state, width - 2, theme, opts.history);
  const framedStrip = bodyH >= 20;
  let stripH = framedStrip ? tokenLines.length + 2 : tokenLines.length;
  while (bodyH - stripH < 6 && tokenLines.length > 1) {
    tokenLines.pop();
    stripH = framedStrip ? tokenLines.length + 2 : tokenLines.length;
  }
  const mainH = bodyH - stripH;

  const orbitPanel = (w: number, h: number): string[] =>
    frame(
      theme.bold(theme.fg("accent", t("net.title"))) + theme.fg("muted", ` · ${state.nodes.length}`),
      opts.orbit(state, Math.max(0, w - 2), Math.max(0, h - 2), theme, { selectedId: opts.selectedId }),
      w,
      h,
      theme,
    );
  const detailPanel = (w: number, h: number): string[] =>
    selected ? panel((iw, ih) => renderDetail(selected, state, iw, ih, theme), w, h, theme) : orbitPanel(w, h);
  const feedPanel = (w: number, h: number): string[] => panel((iw, ih) => renderFeed(state, iw, ih, theme), w, h, theme);
  const tasksPanel = (w: number, h: number): string[] => panel((iw, ih) => renderTasks(state, iw, ih, theme), w, h, theme);
  const chatPanel = (w: number, h: number): string[] => {
    const lines = renderChat(state, Math.max(0, w - 2), Math.max(0, h - 2), theme, opts.chatView);
    const behind = opts.chatView !== undefined && !opts.chatView.follow && opts.chatView.offset > 0;
    const title =
      theme.bold(theme.fg("accent", ct("chat.title"))) +
      (behind ? theme.fg("warning", ` ${ct("chat.newBelow")}`) : "");
    return frame(title, lines, w, h, theme);
  };

  let main: string[];
  if (width >= 110) {
    // Left: orbit (details replace it when the column is tall enough). Right: conversation, thin feed, task summary.
    const leftW = 34;
    const rightW = width - leftW;
    let tasksH = mainH >= 22 ? 4 : mainH >= 16 ? 3 : 0;
    let feedH = mainH >= 26 ? 6 : mainH >= 16 ? 5 : mainH >= 12 ? 4 : 0;
    if (mainH - feedH - tasksH < MIN_CHAT_H) tasksH = 0;
    if (mainH - feedH - tasksH < MIN_CHAT_H) feedH = 0;
    const chatH = mainH - feedH - tasksH;
    const detailInLeft = showDetail && mainH >= 12;
    const left = detailInLeft ? detailPanel(leftW, mainH) : orbitPanel(leftW, mainH);
    const right = [
      ...(showDetail && !detailInLeft ? detailPanel(rightW, chatH) : chatPanel(rightW, chatH)),
      ...(feedH > 0 ? feedPanel(rightW, feedH) : []),
      ...(tasksH > 0 ? tasksPanel(rightW, tasksH) : []),
    ];
    main = joinColumns(left, right);
  } else {
    // Narrow: (medium widths) a small orbit on top, then the conversation and a thin feed.
    const feedH = mainH >= 16 ? 4 : mainH >= 12 ? 3 : 0;
    let orbitH = width >= 70 ? Math.max(7, Math.round(mainH * 0.25)) : 0;
    if (mainH - feedH - orbitH < MIN_CHAT_H + 2) orbitH = 0;
    const chatH = mainH - feedH - orbitH;
    main = [
      ...(orbitH > 0 ? orbitPanel(width, orbitH) : []),
      ...(showDetail ? detailPanel(width, chatH) : chatPanel(width, chatH)),
      ...(feedH > 0 ? feedPanel(width, feedH) : []),
    ];
  }

  const strip = framedStrip
    ? frame(theme.bold(theme.fg("accent", t("tok.title"))), tokenLines, width, stripH, theme)
    : tokenLines.map((l) => padEnd(" " + l, width));

  return [headerRow(state, width, theme), ...main, ...strip, ...promptBox(opts, width, theme)];
}
