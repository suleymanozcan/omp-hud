// Single-line prompt of the full-screen HUD: horizontal scroll, visible block cursor, line editing, bracketed paste,
// session history. It knows nothing about omp; the owner decides what a submit does.
import { matchesKey } from "@oh-my-pi/pi-tui";
import type { SendMode } from "../chat.ts";
import type { HudTheme } from "../types.ts";
import { trunc, vw } from "../util/text.ts";

const MAX_CHARS = 8000; // graphemes
const HISTORY_MAX = 50;
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PROMPT = "❯ ";
const PROMPT_W = 2;

/** `none`: the key is not an input key (the owner may use it); `edit`: handled, redraw; `submit`: Enter / Alt+Enter. */
export type InputResult = { kind: "none" } | { kind: "edit" } | { kind: "submit"; text: string; mode: SendMode };

const NONE: InputResult = { kind: "none" };
const EDIT: InputResult = { kind: "edit" };

let segmenter: Intl.Segmenter | undefined;

function graphemes(s: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

/** Pasted or typed text becomes one line: newlines and tabs turn into spaces, other control characters and ANSI are dropped. */
function flatten(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]?/g, "")
      .replace(/[\r\n\t]+/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
  );
}

/** `ESC [ cp ; mod ; text u` (kitty keyboard protocol) of a printable key without ctrl/alt, else undefined. */
function kittyPrintable(data: string): string | undefined {
  const m = /^\x1b\[(\d+)(?::\d+)*(?:;(\d+)(?::\d+)*)?(?:;([\d:]+))?u$/.exec(data);
  if (!m) return undefined;
  const mod = Number.parseInt(m[2] ?? "1", 10) - 1;
  if ((mod & ~(1 | 64 | 128)) !== 0) return undefined; // anything but shift (and lock bits) is a shortcut
  if (m[3]) {
    const text = String.fromCodePoint(...m[3].split(":").map((c) => Number.parseInt(c, 10)).filter((c) => c >= 32 && c !== 127));
    if (text !== "") return text;
  }
  const cp = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(cp) || cp < 32 || cp === 127 || cp > 0x10ffff) return undefined;
  const ch = String.fromCodePoint(cp);
  return mod & 1 ? ch.toUpperCase() : ch;
}

export class InputLine {
  private chars: string[] = [];
  private widths: number[] = [];
  private cursor = 0;
  private start = 0; // first visible grapheme
  private readonly history: string[] = [];
  private histIdx = -1; // -1: editing a fresh line
  private draft = "";
  private paste: string | undefined; // bracketed paste in progress

  get text(): string {
    return this.chars.join("");
  }

  get isEmpty(): boolean {
    return this.chars.length === 0;
  }

  /** A bracketed paste is in progress (its chunks must not be read as keys). */
  get pasting(): boolean {
    return this.paste !== undefined;
  }

  startsPaste(data: string): boolean {
    return data.includes(PASTE_START);
  }

  /** Puts `text` back into the line (the cursor goes to the end). */
  restore(text: string): void {
    this.setText(text);
    this.histIdx = -1;
  }

  /** The cursor as a UTF-16 offset into `text` (what omp's autocomplete provider works with). */
  get caret(): number {
    return this.chars.slice(0, this.cursor).join("").length;
  }

  /** Replaces the text and puts the cursor at the UTF-16 offset `caret` (rounded up to a grapheme boundary). */
  setAt(text: string, caret: number): void {
    this.setText(text);
    let units = 0;
    let i = 0;
    while (i < this.chars.length && units < caret) units += this.chars[i++]!.length;
    this.cursor = i;
    this.histIdx = -1;
  }

  clear(): void {
    this.chars = [];
    this.widths = [];
    this.cursor = 0;
    this.start = 0;
    this.histIdx = -1;
    this.paste = undefined;
  }

  handleInput(data: string): InputResult {
    if (this.paste !== undefined || data.includes(PASTE_START)) return this.handlePaste(data);
    if (matchesKey(data, "alt+enter") || data === "\x1b\r" || data === "\x1b[13;3u") return this.submit("after");
    if (matchesKey(data, "enter")) return this.submit("steer");
    if (matchesKey(data, "backspace")) return this.edit(this.cursor > 0, () => this.splice(this.cursor - 1, 1, []));
    if (matchesKey(data, "delete")) return this.edit(this.cursor < this.chars.length, () => this.splice(this.cursor, 1, []));
    if (matchesKey(data, "left")) return this.move(this.cursor - 1);
    if (matchesKey(data, "right")) return this.move(this.cursor + 1);
    if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) return this.move(0);
    if (matchesKey(data, "end")) return this.move(this.chars.length);
    if (matchesKey(data, "ctrl+e")) return this.move(this.chars.length);
    if (matchesKey(data, "ctrl+u")) return this.edit(this.chars.length > 0, () => this.splice(0, this.chars.length, []));
    if (matchesKey(data, "ctrl+k")) return this.edit(this.cursor < this.chars.length, () => this.splice(this.cursor, this.chars.length - this.cursor, []));
    if (matchesKey(data, "ctrl+w")) return this.edit(this.cursor > 0, () => this.deleteWord());
    if (matchesKey(data, "up")) return this.recall(-1);
    if (matchesKey(data, "down")) return this.recall(1);
    const text = data.startsWith("\x1b") ? kittyPrintable(data) : flatten(data);
    if (text === undefined || text === "") return NONE;
    this.insert(text);
    return EDIT;
  }

  /** One input row of exactly `width` cells: prompt, visible window of the text, block cursor. */
  render(width: number, theme: HudTheme, placeholder: string): string {
    const w = Math.max(1, width);
    if (w <= PROMPT_W) return " ".repeat(w);
    const prompt = theme.fg("accent", PROMPT);
    const inner = w - PROMPT_W;
    const reverse = (s: string): string => `\x1b[7m${s}\x1b[27m`;
    const n = this.chars.length;
    if (n === 0) return pad(prompt + reverse(" ") + theme.fg("dim", trunc(placeholder, inner - 1)), w);

    const budget = (s: number): number => inner - (s > 0 ? 1 : 0);
    const curW = this.cursor < n ? Math.max(1, this.widths[this.cursor]!) : 1;
    let start = Math.min(this.start, this.cursor);
    let need = curW;
    for (let i = start; i < this.cursor; i++) need += this.widths[i]!;
    while (start < this.cursor && need > budget(start)) need -= this.widths[start++]!;
    this.start = start;

    let after = "";
    let more = false;
    let room = budget(start) - need;
    for (let pass = 0; pass < 2; pass++) {
      after = "";
      let i = this.cursor + 1;
      let used = 0;
      while (i < n && used + this.widths[i]! <= room) {
        used += this.widths[i]!;
        after += this.chars[i]!;
        i++;
      }
      more = i < n;
      if (!more || pass === 1) break;
      room -= 1; // leave a cell for the "more" mark and fill again
    }
    const before = this.chars.slice(start, this.cursor).join("");
    const cur = this.cursor < n ? this.chars[this.cursor]! : " ";
    return pad(
      prompt + (start > 0 ? theme.fg("dim", "…") : "") + before + reverse(cur) + after + (more ? theme.fg("dim", "…") : ""),
      w,
    );
  }

  // --- editing ---

  private splice(at: number, del: number, ins: readonly string[]): void {
    this.chars.splice(at, del, ...ins);
    this.widths.splice(at, del, ...ins.map((g) => vw(g)));
    this.cursor = at + ins.length;
    this.histIdx = -1;
  }

  private insert(text: string): void {
    const room = MAX_CHARS - this.chars.length;
    if (room <= 0) return;
    this.splice(this.cursor, 0, graphemes(text).slice(0, room));
  }

  private edit(possible: boolean, fn: () => void): InputResult {
    if (possible) fn();
    return EDIT;
  }

  private move(to: number): InputResult {
    this.cursor = Math.min(this.chars.length, Math.max(0, to));
    return EDIT;
  }

  private deleteWord(): void {
    let i = this.cursor;
    while (i > 0 && this.chars[i - 1]!.trim() === "") i--;
    while (i > 0 && this.chars[i - 1]!.trim() !== "") i--;
    this.splice(i, this.cursor - i, []);
  }

  private setText(text: string): void {
    const g = graphemes(text);
    this.chars = g;
    this.widths = g.map((x) => vw(x));
    this.cursor = g.length;
    this.start = 0;
  }

  private recall(dir: -1 | 1): InputResult {
    if (this.history.length === 0) return EDIT;
    if (dir === -1) {
      if (this.histIdx === -1) {
        this.draft = this.text;
        this.histIdx = this.history.length - 1;
      } else if (this.histIdx > 0) this.histIdx--;
      else return EDIT;
      this.setText(this.history[this.histIdx]!);
      return EDIT;
    }
    if (this.histIdx === -1) return EDIT;
    this.histIdx++;
    if (this.histIdx >= this.history.length) {
      this.histIdx = -1;
      this.setText(this.draft);
    } else this.setText(this.history[this.histIdx]!);
    return EDIT;
  }

  private submit(mode: SendMode): InputResult {
    const text = this.text.trim();
    if (text !== "") {
      if (this.history[this.history.length - 1] !== text) this.history.push(text);
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    this.clear();
    return { kind: "submit", text, mode };
  }

  /** Bracketed paste: the text between the markers is one edit, even when it arrives in several chunks. */
  private handlePaste(data: string): InputResult {
    let rest = data;
    if (this.paste === undefined) {
      const at = rest.indexOf(PASTE_START);
      rest = rest.slice(at + PASTE_START.length);
      this.paste = "";
    }
    const end = rest.indexOf(PASTE_END);
    if (end === -1) {
      this.paste += rest;
      if (this.paste.length > MAX_CHARS * 8) this.paste = this.paste.slice(0, MAX_CHARS * 8);
      return EDIT;
    }
    const pasted = this.paste + rest.slice(0, end);
    const tail = rest.slice(end + PASTE_END.length);
    this.paste = undefined;
    this.insert(flatten(pasted));
    if (tail === "") return EDIT;
    const next = this.handleInput(tail);
    return next.kind === "submit" ? next : EDIT;
  }
}

function pad(s: string, w: number): string {
  const gap = w - vw(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}
