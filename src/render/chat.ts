// Conversation panel of the full-screen HUD: newest message at the bottom, light markdown (no full renderer),
// scrollable. Pure function of (state, width, height, view); the only side effect is the scroll bookkeeping written into `view`.
import type { ChatMessage, ChatView } from "../chat.ts";
import { ct } from "../chat-i18n.ts";
import { getLang } from "../i18n.ts";
import type { HudState, HudTheme } from "../types.ts";
import { trunc, vw } from "../util/text.ts";

const LABEL_W = 6; // "you ▸ " / "omp ▸ " / "sen ▸ "
const MIN_TEXT_W = 8; // below this the label column is dropped
const CURSOR = "▌";
const TAB = "    ";

type Color = Parameters<HudTheme["fg"]>[0];

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Cuts `text` into pieces of at most `firstW` (first piece) / `restW` (the others) cells; a cluster wider than the room stands alone. */
function cutCells(text: string, firstW: number, restW: number): string[] {
  const out: string[] = [];
  let cur = "";
  let cw = 0;
  let room = Math.max(1, firstW);
  for (const { segment } of graphemes.segment(text)) {
    const sw = vw(segment);
    if (cw + sw > room && cur !== "") {
      out.push(cur);
      cur = "";
      cw = 0;
      room = Math.max(1, restW);
    }
    cur += segment;
    cw += sw;
  }
  if (cur !== "" || out.length === 0) out.push(cur);
  return out;
}

/**
 * Plain text -> pieces of at most `w` visible cells, broken at spaces; a word wider than a line (URL, path) is cut cell by cell.
 * Leading spaces are kept as the indent of every piece. The text has already been sanitized (no escape sequences).
 */
function wrap(text: string, w: number): string[] {
  const width = Math.max(1, w);
  const lead = Math.min(/^ */.exec(text)![0].length, Math.floor(width / 2));
  const pad = " ".repeat(lead);
  const room = width - lead;
  const out: string[] = [];
  let cur = "";
  let cw = 0;
  for (const word of text.split(/ +/)) {
    if (word === "") continue;
    const ww = vw(word);
    if (cur !== "" && cw + 1 + ww <= room) {
      cur += ` ${word}`;
      cw += 1 + ww;
      continue;
    }
    if (cur !== "") out.push(pad + cur);
    if (ww <= room) {
      cur = word;
      cw = ww;
      continue;
    }
    const pieces = cutCells(word, room, room);
    cur = pieces.pop()!;
    cw = vw(cur);
    for (const p of pieces) out.push(pad + p);
  }
  if (cur !== "") out.push(pad + cur);
  return out.length > 0 ? out : [""];
}

/** `wrap` behind a hanging prefix: the first piece gets `first`, the others `rest`; the text is wrapped to the room the wider one leaves. */
function hung(text: string, w: number, first: string, rest: string): string[] {
  return wrap(text, w - Math.max(vw(first), vw(rest))).map((p, i) => (i === 0 ? first : rest) + p);
}

/** Bold/underline emphasis markers fall back to plain text. */
function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}

const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^:?-+:?$/;

function tableCells(line: string): string[] {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
  return cells.map((c) => inline(c.replace(/\\\|/g, "|").trim()));
}

/**
 * A markdown table (consecutive `|` rows). One that fits stays as written. One that does not fit is turned into
 * records: each body row becomes its first cell followed by one `header: value` line per other cell, all wrapped.
 */
function tableLines(rows: string[], w: number, paint: (s: string) => string, theme: HudTheme): string[] {
  if (rows.every((r) => vw(r) <= w)) return rows.map(paint);
  const parsed = rows.map(tableCells);
  const hasHeader = parsed.length >= 2 && parsed[1]!.every((c) => TABLE_RULE.test(c));
  if (!hasHeader) return parsed.flatMap((cells) => hung(cells.filter((c) => c !== "").join(" · "), w, "", "")).map(paint);
  const head = parsed[0]!;
  const out: string[] = [];
  for (const cells of parsed.slice(2)) {
    const title = cells[0] ?? "";
    for (const p of hung(title, w, "▪ ", "  ")) out.push(theme.bold(paint(p)));
    for (let i = 1; i < cells.length; i++) {
      const value = cells[i]!;
      if (value === "") continue;
      const key = head[i] ?? "";
      for (const p of hung(key === "" ? value : `${key}: ${value}`, w, "  ", "    ")) out.push(paint(p));
    }
  }
  return out;
}

/** Message text -> styled lines (no label, no cursor). Nothing is clipped: every source line wraps to the width. */
function bodyLines(text: string, w: number, color: Color, theme: HudTheme): string[] {
  const out: string[] = [];
  let inCode = false;
  let blank = false;
  const paint = (s: string): string => theme.fg(color, s);
  const lines = text.split("\n").map((raw) => raw.replace(/\t/g, TAB).replace(/\s+$/, ""));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(?:```|~~~)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      inCode = !inCode;
      if (inCode && fence[1]) out.push(theme.fg("dim", trunc(`  ┄ ${fence[1]}`, w)));
      blank = false;
      continue;
    }
    if (inCode) {
      // Code keeps its spacing: cut at the cell, continuation pieces start with a ↪.
      const [head, ...tail] = cutCells(line, w - 2, w - 3);
      out.push(theme.fg("dim", `  ${head}`));
      for (const p of tail) out.push(theme.fg("dim", `  ↪${p}`));
      blank = false;
      continue;
    }
    if (line.trim() === "") {
      if (!blank && out.length > 0) out.push("");
      blank = true;
      continue;
    }
    blank = false;
    if (TABLE_ROW.test(line)) {
      const rows = [line];
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1]!)) rows.push(lines[++i]!);
      out.push(...tableLines(rows, w, paint, theme));
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      for (const piece of wrap(inline(heading[1]!), w)) out.push(theme.bold(paint(piece)));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const indent = " ".repeat(Math.min(item[1]!.length, Math.max(0, w - 6)));
      const marker = /\d/.test(item[2]!) ? item[2]! : "•";
      const prefix = `${indent}${marker} `;
      for (const p of hung(inline(item[3]!), w, prefix, " ".repeat(vw(prefix)))) out.push(paint(p));
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      for (const piece of wrap(inline(quote[1]!), w - 2)) out.push(theme.fg("dim", "▎ ") + theme.fg("muted", piece));
      continue;
    }
    for (const piece of wrap(inline(line), w)) out.push(paint(piece));
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** "2 pending (1 steering, 1 after yield)": the HUD's own messages that omp has not started yet; empty when there are none. */
export function pendingBadge(chat: readonly ChatMessage[] | undefined): string {
  let steer = 0;
  let after = 0;
  for (const m of chat ?? []) {
    if (m.pending === "steer") steer++;
    else if (m.pending === "after") after++;
  }
  if (steer + after === 0) return "";
  const parts: string[] = [];
  if (steer > 0) parts.push(after > 0 ? `${steer} ${ct("chat.pendingSteer")}` : ct("chat.pendingSteer"));
  if (after > 0) parts.push(steer > 0 ? `${after} ${ct("chat.pendingAfter")}` : ct("chat.pendingAfter"));
  return ct("chat.pending", { n: steer + after, what: parts.join(", ") });
}

function roleStyle(role: ChatMessage["role"]): { label: string; color: Color; labelColor: Color } {
  if (role === "user") return { label: ct("chat.you"), color: "accent", labelColor: "accent" };
  if (role === "assistant") return { label: ct("chat.omp"), color: "text", labelColor: "success" };
  return { label: ct("chat.sys"), color: "muted", labelColor: "dim" };
}

/** Styled lines of one message including its label column and pending tag (cached per message revision and width). */
function messageLines(msg: ChatMessage, width: number, theme: HudTheme): string[] {
  const labelled = width >= LABEL_W + MIN_TEXT_W;
  const textW = labelled ? width - LABEL_W : width;
  const { label, color, labelColor } = roleStyle(msg.role);
  const body = msg.text === "" ? [] : bodyLines(msg.text, textW, color, theme);
  if (msg.pending === "after" || msg.pending === "steer") {
    const tag = theme.fg("warning", `· ${ct(msg.pending === "after" ? "chat.after" : "chat.steer")}`);
    const last = body.length - 1;
    if (last >= 0 && vw(body[last]!) + 1 + vw(tag) <= textW) body[last] = `${body[last]} ${tag}`;
    else body.push(tag);
  }
  if (body.length === 0) body.push("");
  if (!labelled) return body;
  const head = theme.bold(theme.fg(labelColor, label)) + " ";
  return body.map((l, i) => (i === 0 ? head : " ".repeat(LABEL_W)) + l);
}

function withCursor(lines: string[], width: number, theme: HudTheme, phase: number): void {
  const glyph = Math.floor(Math.max(0, phase) * 3) % 2 === 0 ? theme.fg("accent", CURSOR) : " ";
  const last = lines.length - 1;
  if (last >= 0 && vw(lines[last]!) + 1 <= width) lines[last] += glyph;
  else lines.push(" ".repeat(Math.min(LABEL_W, Math.max(0, width - 1))) + glyph);
}

/**
 * Exactly `height` rows, each at most `width` cells. `view` (optional) carries the scroll position:
 * `follow` sticks to the newest line, otherwise `offset` lines are scrolled up from the bottom and a growing
 * conversation does not move what is on screen. When the width changes the wrapped line counts change too: the
 * line at the bottom of the view is remembered as (message, fraction of that message) and found again at the new width.
 * The renderer writes `max`/`lastTotal`/`offset`/`width`/`anchor` back.
 */
export function renderChat(state: HudState, width: number, height: number, theme: HudTheme, view?: ChatView): string[] {
  if (height <= 0) return [];
  const w = Math.max(1, width);
  const messages = state.chat ?? [];
  const all: string[] = [];
  const spans: Array<{ id: string; start: number; len: number }> = [];
  if (messages.length === 0) {
    all.push(theme.fg("dim", trunc(ct("chat.empty"), w)));
  } else {
    const lang = getLang();
    const cache = view?.cache;
    const live = new Set<string>();
    messages.forEach((msg, i) => {
      if (i > 0) all.push("");
      const key = `${msg.rev}|${w}|${lang}|${msg.pending ?? ""}`;
      let lines = cache?.get(msg.id);
      if (!lines || lines.key !== key) {
        lines = { key, lines: messageLines(msg, w, theme) };
        cache?.set(msg.id, lines);
      }
      live.add(msg.id);
      const start = all.length;
      if (msg.streaming) {
        const copy = [...lines.lines];
        withCursor(copy, w, theme, state.phase);
        all.push(...copy);
      } else all.push(...lines.lines);
      spans.push({ id: msg.id, start, len: all.length - start });
    });
    if (cache && cache.size > live.size) for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
  }

  const total = all.length;
  const max = Math.max(0, total - height);
  let offset = 0;
  if (view) {
    const anchored = view.anchor && spans.find((s) => s.id === view.anchor!.id);
    if (!view.follow && view.width !== 0 && view.width !== w && anchored) {
      view.offset = total - (anchored.start + Math.max(1, Math.round(view.anchor!.frac * anchored.len)));
    } else if (!view.follow && view.lastTotal > 0 && total > view.lastTotal) view.offset += total - view.lastTotal;
    offset = view.follow ? 0 : Math.min(Math.max(0, view.offset), max);
    view.offset = offset;
    view.max = max;
    view.page = height;
    view.lastTotal = total;
    view.width = w;
    view.anchor = undefined;
    if (!view.follow) {
      const bottom = total - offset - 1;
      let at = spans.length - 1;
      while (at > 0 && spans[at]!.start > bottom) at--;
      const span = spans[at];
      if (span) view.anchor = { id: span.id, frac: Math.min(1, Math.max(0, (bottom - span.start + 1) / span.len)) };
    }
  }
  const end = total - offset;
  const start = Math.max(0, end - height);
  const out = all.slice(start, end).map((l) => (vw(l) > w ? trunc(l, w) : l));
  while (out.length < height) out.push("");
  return out;
}
