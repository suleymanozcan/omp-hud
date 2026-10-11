// Braille canvas: every cell is 2x4 sub-pixels with ONE color per cell (the last write wins).
// Color = theme token | {r,g,b} | packed integer (no allocation on the hot path).

import type { HudTheme } from "../types";

export type Hue = "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text";
export interface RGB {
  r: number;
  g: number;
  b: number;
  /** theme token to use when truecolor is unavailable (default: text) */
  fallback?: Hue;
}
export type Color = Hue | RGB | number;

const HUES: readonly Hue[] = ["accent", "success", "error", "warning", "muted", "dim", "text"];
const HAS_RGB = 1 << 27;

function hueIndex(h: Hue): number {
  switch (h) {
    case "accent":
      return 0;
    case "success":
      return 1;
    case "error":
      return 2;
    case "warning":
      return 3;
    case "muted":
      return 4;
    case "dim":
      return 5;
    default:
      return 6;
  }
}

/** Packed color: bits 0-23 rgb, bits 24-26 (token index+1), bit 27 rgb present. 0 = no color (not drawn). */
export function packColor(c: Color): number {
  if (typeof c === "number") return c;
  if (typeof c === "string") return (hueIndex(c) + 1) << 24;
  const r = c.r & 255;
  const g = c.g & 255;
  const b = c.b & 255;
  return ((hueIndex(c.fallback ?? "text") + 1) << 24) | HAS_RGB | (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------------- palette

export interface Palette {
  /** 7 tokens x (r,g,b) */
  rgb: Uint8Array;
}

const DEFAULT_RGB: readonly (readonly [number, number, number])[] = [
  [0, 200, 255], // accent
  [70, 220, 130], // success
  [255, 70, 80], // error
  [255, 185, 50], // warning
  [150, 160, 175], // muted
  [80, 88, 100], // dim
  [230, 235, 240], // text
];

const TRUECOLOR_RE = /\x1b\[38;2;(\d+);(\d+);(\d+)m/;
let cachedTheme: HudTheme | null = null;
let cachedSig = "";
let cachedPalette: Palette | null = null;

/** Derives a palette from the theme colors (when the truecolor escape can be parsed); otherwise the default. Called once per frame. */
export function paletteFor(theme: HudTheme): Palette {
  let sig = "";
  try {
    sig = theme.fg("accent", "x") + theme.fg("error", "x");
  } catch {
    sig = "";
  }
  if (cachedPalette && cachedTheme === theme && cachedSig === sig) return cachedPalette;
  const rgb = new Uint8Array(HUES.length * 3);
  for (let i = 0; i < HUES.length; i++) {
    let r = DEFAULT_RGB[i][0];
    let g = DEFAULT_RGB[i][1];
    let b = DEFAULT_RGB[i][2];
    if (theme.truecolor) {
      try {
        const m = TRUECOLOR_RE.exec(theme.fg(HUES[i], "x"));
        if (m) {
          r = Number(m[1]);
          g = Number(m[2]);
          b = Number(m[3]);
        }
      } catch {
        /* varsayilan */
      }
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  cachedTheme = theme;
  cachedSig = sig;
  cachedPalette = { rgb };
  return cachedPalette;
}

const LEVELS = 15;

/** Hue x brightness (0..1). Quantized to 16 levels (consecutive cells merge into one ANSI run). <~0.03 -> 0 (not drawn). */
export function shade(pal: Palette, hue: Hue, intensity: number): number {
  if (!(intensity > 0.03)) return 0;
  const q = intensity >= 1 ? LEVELS : Math.max(1, Math.round(intensity * LEVELS));
  const hi = hueIndex(hue);
  const k = 0.2 + 0.8 * (q / LEVELS);
  const o = hi * 3;
  const r = Math.round(pal.rgb[o] * k);
  const g = Math.round(pal.rgb[o + 1] * k);
  const b = Math.round(pal.rgb[o + 2] * k);
  let fb: number;
  switch (hue) {
    case "accent":
      fb = q >= 10 ? 0 : q >= 5 ? 4 : 5;
      break;
    case "text":
      fb = q >= 10 ? 6 : q >= 5 ? 4 : 5;
      break;
    case "muted":
      fb = q >= 8 ? 4 : 5;
      break;
    case "dim":
      fb = 5;
      break;
    default:
      fb = q >= 6 ? hi : 5;
  }
  return ((fb + 1) << 24) | HAS_RGB | (r << 16) | (g << 8) | b;
}

/** Deterministic 0..1 pseudo-random (for noise/flicker). */
export function hash01(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- canvas

const TAU = Math.PI * 2;
// braille bit map: [dx][dy]
const DOT: readonly (readonly number[])[] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];
const BRAILLE: string[] = [];
for (let i = 0; i < 256; i++) BRAILLE.push(String.fromCharCode(0x2800 + i));

const escCache = new Map<number, string>();
function rgbPrefix(code: number): string {
  let s = escCache.get(code);
  if (s === undefined) {
    if (escCache.size > 4000) escCache.clear();
    s = `\x1b[38;2;${(code >> 16) & 255};${(code >> 8) & 255};${code & 255}m`;
    escCache.set(code, s);
  }
  return s;
}

function paint(code: number, text: string, theme: HudTheme): string {
  if (code & HAS_RGB && theme.truecolor) return `${rgbPrefix(code)}${text}\x1b[39m`;
  const idx = ((code >> 24) & 7) - 1;
  return theme.fg(HUES[idx < 0 ? 4 : idx], text);
}

export class BrailleCanvas {
  cols = 0;
  rows = 0;
  /** sub-pixel width/height (cols*2, rows*4) */
  pw = 0;
  ph = 0;
  private bits = new Uint8Array(0);
  private color = new Int32Array(0);
  private chars = new Uint16Array(0);
  private out: string[] = [];

  constructor(cols: number, rows: number) {
    this.resize(cols, rows);
  }

  /** Allocates nothing when the size is unchanged. */
  resize(cols: number, rows: number): void {
    cols = Math.max(0, Math.floor(cols));
    rows = Math.max(0, Math.floor(rows));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.pw = cols * 2;
    this.ph = rows * 4;
    const n = cols * rows;
    if (this.bits.length !== n) {
      this.bits = new Uint8Array(n);
      this.color = new Int32Array(n);
      this.chars = new Uint16Array(n);
    }
    this.out.length = rows;
    for (let r = 0; r < rows; r++) this.out[r] = "";
  }

  clear(): void {
    this.bits.fill(0);
    this.color.fill(0);
    this.chars.fill(0);
  }

  /** Writes a sub-pixel (fractional coordinates are rounded). Ignored when the color is 0 or the cell holds text. */
  set(x: number, y: number, color: Color): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.pw || yi >= this.ph) return;
    const code = typeof color === "number" ? color : packColor(color);
    if (code === 0) return;
    const idx = (yi >> 2) * this.cols + (xi >> 1);
    if (this.chars[idx] !== 0) return;
    this.bits[idx] |= DOT[xi & 1][yi & 3];
    this.color[idx] = code;
  }

  /** Bresenham; when `every` > 1 the line is dotted (one pixel out of every `every`). */
  line(x0: number, y0: number, x1: number, y1: number, color: Color, every = 1): void {
    const code = packColor(color);
    if (code === 0) return;
    let xa = Math.round(x0);
    let ya = Math.round(y0);
    const xb = Math.round(x1);
    const yb = Math.round(y1);
    const dx = Math.abs(xb - xa);
    const dy = -Math.abs(yb - ya);
    const sx = xa < xb ? 1 : -1;
    const sy = ya < yb ? 1 : -1;
    let err = dx + dy;
    let i = 0;
    for (;;) {
      if (i % every === 0) this.set(xa, ya, code);
      if (xa === xb && ya === yb) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        xa += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ya += sy;
      }
      i++;
    }
  }

  circle(cx: number, cy: number, r: number, color: Color, every = 1): void {
    this.arc(cx, cy, r, 0, TAU, color, every);
  }

  /** a0..a1 in radians (0 = right, increasing clockwise; y points down). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, color: Color, every = 1): void {
    const code = packColor(color);
    if (code === 0 || r < 0) return;
    const span = a1 - a0;
    const n = Math.max(2, Math.ceil(Math.abs(span) * Math.max(r, 1) * 1.1));
    const step = span / n;
    for (let i = 0; i <= n; i++) {
      if (i % every !== 0) continue;
      const a = a0 + step * i;
      this.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, code);
    }
  }

  fillCircle(cx: number, cy: number, r: number, color: Color): void {
    const code = packColor(color);
    if (code === 0) return;
    const ccx = Math.round(cx);
    const ccy = Math.round(cy);
    if (r < 0.5) {
      this.set(ccx, ccy, code);
      return;
    }
    const lim = r * r + r * 0.6;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy <= lim) this.set(ccx + dx, ccy + dy, code);
      }
    }
  }

  /** Writes plain text onto the cell grid (overwrites braille in those cells). Single-cell width is assumed. */
  text(col: number, row: number, text: string, color: Color): void {
    if (row < 0 || row >= this.rows) return;
    const code = packColor(color);
    for (let i = 0; i < text.length; i++) {
      const c = col + i;
      if (c < 0 || c >= this.cols) continue;
      const idx = row * this.cols + c;
      this.chars[idx] = text.charCodeAt(i);
      this.color[idx] = code === 0 ? (5 + 1) << 24 : code;
    }
  }

  /**
   * ANSI rows. THE RETURNED ARRAY IS THE SAME OBJECT ON EVERY CALL (updated in place); copy it to keep it.
   * Consecutive cells of the same color merge into one run; without truecolor it falls back to the theme token.
   */
  toRows(theme: HudTheme): string[] {
    const { cols, rows, bits, color, chars, out } = this;
    for (let r = 0; r < rows; r++) {
      let line = "";
      let run = "";
      let runColor = -1;
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = base + c;
        const ch = chars[idx];
        let s: string;
        if (ch !== 0) s = String.fromCharCode(ch);
        else if (bits[idx] !== 0) s = BRAILLE[bits[idx]];
        else {
          run += " ";
          continue;
        }
        const col = color[idx];
        if (col !== runColor) {
          if (run.length > 0) line += runColor < 0 ? run : paint(runColor, run, theme);
          run = "";
          runColor = col;
        }
        run += s;
      }
      if (run.length > 0) line += runColor < 0 ? run : paint(runColor, run, theme);
      out[r] = line;
    }
    return out;
  }
}
