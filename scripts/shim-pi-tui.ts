// Stand-in for the "@oh-my-pi/pi-tui" module, used ONLY when running outside omp (plain `bun`) for previews and smoke tests.
// src/* MUST be imported dynamically AFTER this file is imported (static imports are hoisted above the shim).
// Measuring rules approximate omp's: ANSI = 0 cells, combining marks/ZWJ/variation selectors = 0, CJK + fullwidth = 2, everything else = 1.

const ANSI_RE = /\x1b\[[0-9;:?]*[\x40-\x7e]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;

function charWidth(cp: number): number {
  if (cp === 0 || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x200b && cp <= 0x200f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

interface Token {
  text: string;
  w: number;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      ANSI_RE.lastIndex = i;
      const m = ANSI_RE.exec(text);
      if (m) {
        out.push({ text: m[0], w: 0 });
        i += m[0].length;
        continue;
      }
    }
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out.push({ text: ch, w: charWidth(cp) });
    i += ch.length;
  }
  return out;
}

export function visibleWidth(text: string): number {
  let w = 0;
  for (const t of tokenize(text)) w += t.w;
  return w;
}

export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…", pad = false): string {
  if (maxWidth <= 0) return "";
  const toks = tokenize(text);
  let total = 0;
  for (const t of toks) total += t.w;
  if (total <= maxWidth) return pad ? text + " ".repeat(maxWidth - total) : text;
  const ew = visibleWidth(ellipsis);
  const budget = Math.max(0, maxWidth - ew);
  let out = "";
  let w = 0;
  for (const t of toks) {
    if (t.w === 0) {
      out += t.text;
      continue;
    }
    if (w + t.w > budget) break;
    out += t.text;
    w += t.w;
  }
  out += "\x1b[0m" + (ew <= maxWidth ? ellipsis : "");
  w += ew <= maxWidth ? ew : 0;
  return pad && w < maxWidth ? out + " ".repeat(maxWidth - w) : out;
}

export function matchesKey(data: string, keyId: string): boolean {
  const map: Record<string, string[]> = {
    escape: ["\x1b"],
    esc: ["\x1b"],
    enter: ["\r", "\n"],
    tab: ["\t"],
    up: ["\x1b[A", "\x1bOA"],
    down: ["\x1b[B", "\x1bOB"],
    right: ["\x1b[C", "\x1bOC"],
    left: ["\x1b[D", "\x1bOD"],
    "ctrl+c": ["\x03"],
    "shift+tab": ["\x1b[Z"],
  };
  const k = keyId.toLowerCase();
  return map[k] ? map[k]!.includes(data) : data === keyId;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let cur = "";
  let w = 0;
  for (const t of tokenize(text)) {
    if (t.w > 0 && w + t.w > width) {
      lines.push(cur);
      cur = "";
      w = 0;
    }
    cur += t.text;
    w += t.w;
  }
  lines.push(cur);
  return lines;
}

let installed = false;

/** Idempotent. Redirects "@oh-my-pi/pi-tui" imports to this stand-in under plain bun. */
export function installPiTuiShim(): void {
  if (installed) return;
  installed = true;
  Bun.plugin({
    name: "hud-pi-tui-shim",
    setup(build) {
      build.module("@oh-my-pi/pi-tui", () => ({
        exports: { visibleWidth, truncateToWidth, matchesKey, wrapTextWithAnsi },
        loader: "object",
      }));
    },
  });
}
