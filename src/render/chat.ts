// Conversation panel of the full-screen HUD: newest message at the bottom, light markdown (no full renderer),
// scrollable. Pure function of (state, width, height, view); the only side effect is the scroll bookkeeping written into `view`.
import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { ChatMessage, ChatView } from "../chat.ts";
import { ct } from "../chat-i18n.ts";
import { getLang } from "../i18n.ts";
import type { HudState, HudTheme } from "../types.ts";
import { trunc, vw } from "../util/text.ts";

const LABEL_W = 6; // "you ▸ " / "omp ▸ " / "sen ▸ "
const MIN_TEXT_W = 8; // below this the label column is dropped
const CURSOR = "▌";

type Color = Parameters<HudTheme["fg"]>[0];

/** Source line -> wrapped plain pieces; never wider than `w`. */
function wrap(text: string, w: number): string[] {
  const out = wrapTextWithAnsi(text, Math.max(1, w));
  return out.length > 0 ? out : [""];
}

/** Bold/underline emphasis markers fall back to plain text. */
function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}

/** Message text -> styled lines (no label, no cursor). Code blocks are dim, indented and clipped instead of wrapped. */
function bodyLines(text: string, w: number, color: Color, theme: HudTheme): string[] {
  const out: string[] = [];
  let inCode = false;
  let blank = false;
  const paint = (s: string): string => theme.fg(color, s);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const fence = /^\s*(?:```|~~~)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      inCode = !inCode;
      if (inCode && fence[1]) out.push(theme.fg("dim", trunc(`  ┄ ${fence[1]}`, w)));
      blank = false;
      continue;
    }
    if (inCode) {
      out.push(theme.fg("dim", trunc(`  ${line}`, w)));
      blank = false;
      continue;
    }
    if (line.trim() === "") {
      if (!blank && out.length > 0) out.push("");
      blank = true;
      continue;
    }
    blank = false;
    if (/^\s*\|/.test(line)) {
      out.push(paint(trunc(line, w)));
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
      const hang = " ".repeat(vw(prefix));
      const pieces = wrap(inline(item[3]!), w - vw(prefix));
      pieces.forEach((p, i) => out.push(paint((i === 0 ? prefix : hang) + p)));
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
  if (msg.pending === "queued" || msg.pending === "steer") {
    const tag = theme.fg("warning", `· ${ct(msg.pending === "queued" ? "chat.queued" : "chat.steer")}`);
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
 * conversation does not move what is on screen. The renderer writes `max`/`lastTotal`/`offset` back.
 */
export function renderChat(state: HudState, width: number, height: number, theme: HudTheme, view?: ChatView): string[] {
  if (height <= 0) return [];
  const w = Math.max(1, width);
  const messages = state.chat ?? [];
  let all: string[] = [];
  if (messages.length === 0) {
    all = [theme.fg("dim", trunc(ct("chat.empty"), w))];
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
      if (msg.streaming) {
        const copy = [...lines.lines];
        withCursor(copy, w, theme, state.phase);
        all.push(...copy);
      } else all.push(...lines.lines);
    });
    if (cache && cache.size > live.size) for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
  }

  const total = all.length;
  const max = Math.max(0, total - height);
  let offset = 0;
  if (view) {
    if (!view.follow && view.lastTotal > 0 && total > view.lastTotal) view.offset += total - view.lastTotal;
    offset = view.follow ? 0 : Math.min(Math.max(0, view.offset), max);
    view.offset = offset;
    view.max = max;
    view.page = height;
    view.lastTotal = total;
  }
  const end = total - offset;
  const start = Math.max(0, end - height);
  const out = all.slice(start, end).map((l) => (vw(l) > w ? trunc(l, w) : l));
  while (out.length < height) out.push("");
  return out;
}
