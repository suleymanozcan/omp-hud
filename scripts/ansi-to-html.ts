// Converts ANSI text frames (SGR: 24-bit, 256, basic colors, bold, dim, italic, underline, reverse) to a full HTML page.
// Self-contained: no external dependencies. Only for visual checks (used by scripts/preview.ts).

export interface HtmlFrame {
  /** Frame caption (example: "t=12s"). */
  title?: string;
  /** ANSI lines (may contain SGR sequences). */
  lines: readonly string[];
}

export interface HtmlOptions {
  /** Page title. */
  title?: string;
  /** Grid column count (1 = stacked). Default 1. */
  columns?: number;
  /** Font size in px. Default 14. */
  fontSize?: number;
  /** Line height in px. Default round(fontSize * 1.15). */
  lineHeight?: number;
  /** Default foreground color. */
  defaultFg?: string;
}

interface Style {
  fg?: string;
  bg?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
}

const BASIC = [
  "#000000",
  "#cd3131",
  "#0dbc79",
  "#e5e510",
  "#2472c8",
  "#bc3fbc",
  "#11a8cd",
  "#e5e5e5",
];
const BRIGHT = [
  "#666666",
  "#f14c4c",
  "#23d18b",
  "#f5f543",
  "#3b8eea",
  "#d670d6",
  "#29b8db",
  "#ffffff",
];

function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const lv = [0, 95, 135, 175, 215, 255];
    return rgb(lv[Math.floor(i / 36)]!, lv[Math.floor(i / 6) % 6]!, lv[i % 6]!);
  }
  const g = 8 + (n - 232) * 10;
  return rgb(g, g, g);
}

function rgb(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function freshStyle(): Style {
  return { bold: false, dim: false, italic: false, underline: false, reverse: false };
}

function applySgr(style: Style, params: number[]): void {
  if (params.length === 0) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) Object.assign(style, freshStyle(), { fg: undefined, bg: undefined });
    else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 3) style.italic = true;
    else if (p === 4) style.underline = true;
    else if (p === 7) style.reverse = true;
    else if (p === 22) {
      style.bold = false;
      style.dim = false;
    } else if (p === 23) style.italic = false;
    else if (p === 24) style.underline = false;
    else if (p === 27) style.reverse = false;
    else if (p >= 30 && p <= 37) style.fg = BASIC[p - 30];
    else if (p === 39) style.fg = undefined;
    else if (p >= 40 && p <= 47) style.bg = BASIC[p - 40];
    else if (p === 49) style.bg = undefined;
    else if (p >= 90 && p <= 97) style.fg = BRIGHT[p - 90];
    else if (p >= 100 && p <= 107) style.bg = BRIGHT[p - 100];
    else if (p === 38 || p === 48) {
      const mode = params[i + 1];
      let value: string | undefined;
      if (mode === 2) {
        value = rgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 4;
      } else if (mode === 5) {
        value = color256(params[i + 2] ?? -1);
        i += 2;
      }
      if (p === 38) style.fg = value;
      else style.bg = value;
    }
  }
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Non-ASCII glyphs can fall back to fonts with a different advance: wrap each one in a 1ch box. */
function renderText(text: string): string {
  let out = "";
  let run = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp < 0x7f) {
      run += ch;
    } else {
      if (run) {
        out += esc(run);
        run = "";
      }
      if (cp >= 0x20) out += `<i class="w">${esc(ch)}</i>`;
    }
  }
  if (run) out += esc(run);
  return out;
}

function spanOpen(style: Style, defaultFg: string): string {
  let fg = style.fg;
  let bg = style.bg;
  if (style.reverse) {
    const f = fg ?? defaultFg;
    fg = bg ?? "#000000";
    bg = f;
  }
  const css: string[] = [];
  if (fg) css.push(`color:${fg}`);
  if (bg) css.push(`background:${bg}`);
  if (style.bold) css.push("font-weight:bold");
  if (style.dim) css.push("opacity:.6");
  if (style.italic) css.push("font-style:italic");
  if (style.underline) css.push("text-decoration:underline");
  return css.length ? `<span style="${css.join(";")}">` : "";
}

/** Converts the ANSI of one line to spans. Style is carried across lines through `style`. */
function lineToHtml(line: string, style: Style, defaultFg: string): string {
  let out = "";
  let pos = 0;
  const re = /\x1b\[([0-9;:]*)([\x40-\x7e])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  const emit = (text: string): void => {
    if (!text) return;
    const open = spanOpen(style, defaultFg);
    const body = renderText(text);
    out += open ? `${open}${body}</span>` : body;
  };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    emit(line.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[2] === "m") applySgr(style, m[1]!.split(/[;:]/).map((s) => (s === "" ? 0 : Number(s))));
  }
  emit(line.slice(pos));
  return out;
}

/** Converts lines to a `<pre>` body (a fragment, not a document). */
export function ansiLinesToHtml(lines: readonly string[], defaultFg = "#d4d4d4"): string {
  const style = freshStyle();
  return lines.map((l) => lineToHtml(l, style, defaultFg)).join("\n");
}

/** Converts several frames to a complete, self-contained HTML document (black background, Menlo, fixed cell). */
export function framesToHtml(frames: readonly HtmlFrame[], opts: HtmlOptions = {}): string {
  const fontSize = opts.fontSize ?? 14;
  const lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.15);
  const columns = Math.max(1, opts.columns ?? 1);
  const defaultFg = opts.defaultFg ?? "#d4d4d4";
  const blocks = frames
    .map((f) => {
      const cap = f.title ? `<div class="cap">${esc(f.title)}</div>` : "";
      return `<section>${cap}<pre>${ansiLinesToHtml(f.lines, defaultFg)}</pre></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(opts.title ?? "HUD preview")}</title>
<style>
  html, body { margin: 0; background: #000; color: ${defaultFg}; }
  body { padding: 8px; }
  .grid { display: grid; grid-template-columns: repeat(${columns}, max-content); gap: 18px 24px; align-items: start; }
  .cap { font: 12px/16px -apple-system, system-ui, sans-serif; color: #8a8a8a; margin-bottom: 3px; }
  pre {
    margin: 0;
    font-family: Menlo, Monaco, monospace;
    font-size: ${fontSize}px;
    line-height: ${lineHeight}px;
    white-space: pre;
    font-variant-ligatures: none;
    font-kerning: none;
    letter-spacing: 0;
  }
  pre span { line-height: ${lineHeight}px; }
  .w { display: inline-block; vertical-align: top; width: 1ch; height: ${lineHeight}px; line-height: ${lineHeight}px; text-align: center; font-style: normal; white-space: pre; }
</style>
</head>
<body>
<div class="grid">
${blocks}
</div>
</body>
</html>
`;
}

/** Single-frame shortcut. */
export function ansiToHtml(frame: string | readonly string[], opts: HtmlOptions = {}): string {
  const lines = typeof frame === "string" ? frame.split("\n") : frame;
  return framesToHtml([{ lines }], opts);
}
