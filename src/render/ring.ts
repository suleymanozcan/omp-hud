// Orbit rings: places nodes around the core and draws them. Pure; derived from phase and time.

import { type HudNode, type HudState, type HudTheme, MAX_NODES } from "../types";
import { BrailleCanvas, type Palette, paletteFor, shade } from "./canvas";

const TAU = Math.PI * 2;
/** Core radius / total orbit radius (shared with orbit-scene). */
export const CORE_RATIO = 0.4;
const RING_FRAC = [0.7, 0.85, 0.99];
const RING_MAX = [10, 12, 10];
const MIN_SPACING = 9; // sub-pixels
const RING_DIR = [1, -1, 1];
const RING_OFFSET = [0, 0.4, 0.8];
const TRANSITION_MS = 600;

export interface NodePos {
  node: HudNode;
  x: number;
  y: number;
  ring: number;
  angle: number;
  /** position of the parent when it is visible, otherwise null (links to the core) */
  parent: NodePos | null;
}

const pool: NodePos[] = [];
for (let i = 0; i < MAX_NODES; i++) pool.push({ node: null as unknown as HudNode, x: 0, y: 0, ring: 0, angle: 0, parent: null });
const result: NodePos[] = [];
const picked: HudNode[] = [];

function ringCapacity(radius: number, k: number): number {
  return Math.min(RING_MAX[k], Math.max(1, Math.floor((TAU * RING_FRAC[k] * radius) / MIN_SPACING)));
}

/** Upper bound on visible nodes (the rest collapse into `+N`). */
export function nodeCapacity(radius: number): number {
  return Math.min(MAX_NODES, ringCapacity(radius, 0) + ringCapacity(radius, 1) + ringCapacity(radius, 2));
}

function pickVisible(nodes: readonly HudNode[], cap: number): void {
  picked.length = 0;
  if (nodes.length <= cap) {
    for (const n of nodes) picked.push(n);
    return;
  }
  // Running nodes first, then the newest; insertion order is kept.
  let running = 0;
  for (const n of nodes) if (n.status === "running") running++;
  const keepRun = Math.min(running, cap);
  let skipRun = running - keepRun;
  let skipOther = nodes.length - running - (cap - keepRun);
  for (const n of nodes) {
    if (n.status === "running") {
      if (skipRun > 0) {
        skipRun--;
        continue;
      }
    } else if (skipOther > 0) {
      skipOther--;
      continue;
    }
    picked.push(n);
  }
}

/**
 * Node positions (sub-pixels). THE RETURNED ARRAY AND OBJECTS ARE REUSED: they are valid until the next call.
 * `radius` is the total orbit radius; the first 10 nodes use the inner ring, the rest the 2nd and 3rd rings.
 */
export function layoutNodes(nodes: readonly HudNode[], cx: number, cy: number, radius: number, phase: number): readonly NodePos[] {
  pickVisible(nodes, nodeCapacity(radius));
  result.length = 0;
  let idx = 0;
  const total = picked.length;
  for (let k = 0; k < 3 && idx < total; k++) {
    const count = Math.min(ringCapacity(radius, k), total - idx);
    const r = radius * RING_FRAC[k];
    const spacing = Math.min(TAU / count, 0.9);
    const base = -Math.PI / 2 + RING_OFFSET[k] + RING_DIR[k] * 0.05 * phase;
    for (let s = 0; s < count; s++, idx++) {
      const node = picked[idx];
      let a = base + (s * TAU) / count;
      if (node.status === "running") a += 0.4 * spacing * Math.sin(1.5 * phase + s * 1.7);
      const p = pool[idx];
      p.node = node;
      p.ring = k;
      p.angle = a;
      p.x = cx + Math.cos(a) * r;
      p.y = cy + Math.sin(a) * r;
      p.parent = null;
      result.push(p);
    }
  }
  for (const p of result) {
    const pid = p.node.parentId;
    if (!pid) continue;
    for (const q of result) {
      if (q !== p && q.node.id === pid) {
        p.parent = q;
        break;
      }
    }
  }
  return result;
}

interface LinkEnds {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}
const link: LinkEnds = { sx: 0, sy: 0, ex: 0, ey: 0 };

/** Shortened link endpoints from a node to its target (parent or core edge). */
function linkEnds(p: NodePos, cx: number, cy: number, coreR: number): LinkEnds {
  const tx = p.parent ? p.parent.x : cx;
  const ty = p.parent ? p.parent.y : cy;
  let dx = tx - p.x;
  let dy = ty - p.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  link.sx = p.x + dx * 3;
  link.sy = p.y + dy * 3;
  const endOff = p.parent ? -3 : -coreR * 1.25;
  link.ex = tx + dx * endOff;
  link.ey = ty + dy * endOff;
  return link;
}

function drawNode(c: BrailleCanvas, pal: Palette, p: NodePos, t: number, nowMs: number, selected: boolean, idx: number): void {
  const n = p.node;
  const { x, y } = p;
  switch (n.status) {
    case "running": {
      const pulse = 0.5 + 0.5 * Math.sin(TAU * 1.4 * t + idx * 0.9);
      c.circle(x, y, 3.6 + pulse, shade(pal, "accent", 0.3 + 0.25 * pulse));
      c.fillCircle(x, y, 1.3 + pulse * 1.2, shade(pal, "accent", 1));
      break;
    }
    case "completed":
      c.fillCircle(x, y, 2.2, shade(pal, "success", 0.6));
      break;
    case "failed": {
      const on = Math.sin(TAU * 2 * t) > 0;
      const col = shade(pal, "error", on ? 1 : 0.3);
      c.circle(x, y, 3.6, col);
      c.line(x - 2, y - 2, x + 2, y + 2, col);
      c.line(x - 2, y + 2, x + 2, y - 2, col);
      break;
    }
    default:
      c.circle(x, y, 2, shade(pal, "error", 0.3));
  }
  if (n.retrying) {
    const col = shade(pal, "warning", 0.95);
    for (let k = 0; k < 3; k++) {
      const a = t * 2 + (k * TAU) / 3;
      c.arc(x, y, 5, a, a + 1.3, col);
    }
  }
  if (n.endedAt !== undefined) {
    const e = (nowMs - n.endedAt) / TRANSITION_MS;
    if (e >= 0 && e < 1) {
      c.circle(x, y, 2 + 10 * e, shade(pal, n.status === "completed" ? "success" : "error", (1 - e) * 0.95));
    }
  }
  if (selected) c.circle(x, y, 6.5, shade(pal, "text", 0.8));
}

/** Draws the rings, links and nodes; returns the layout array (for labels). */
export function drawRing(
  c: BrailleCanvas,
  state: HudState,
  cx: number,
  cy: number,
  radius: number,
  theme: HudTheme,
  selectedId?: string,
): readonly NodePos[] {
  const pal = paletteFor(theme);
  const t = state.phase;
  const coreR = radius * CORE_RATIO;
  const pos = layoutNodes(state.nodes, cx, cy, radius, t);

  let rings = 0;
  for (const p of pos) if (p.ring + 1 > rings) rings = p.ring + 1;
  for (let k = 0; k < rings; k++) c.circle(cx, cy, radius * RING_FRAC[k], shade(pal, "dim", 0.5), 4);

  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const e = linkEnds(p, cx, cy, coreR);
    switch (p.node.status) {
      case "running": {
        c.line(e.sx, e.sy, e.ex, e.ey, shade(pal, "accent", 0.6), 2);
        const t1 = (t * 0.7 + i * 0.31) % 1;
        const t2 = (t1 + 0.5) % 1;
        c.fillCircle(e.ex + (e.sx - e.ex) * t1, e.ey + (e.sy - e.ey) * t1, 1, shade(pal, "accent", 1));
        c.fillCircle(e.sx + (e.ex - e.sx) * t2, e.sy + (e.ey - e.sy) * t2, 1, shade(pal, "accent", 0.7));
        break;
      }
      case "completed":
        c.line(e.sx, e.sy, e.ex, e.ey, shade(pal, "success", 0.28), 3);
        break;
      case "failed":
        c.line(e.sx, e.sy, e.ex, e.ey, shade(pal, "error", 0.4), 3);
        break;
      default:
        c.line(e.sx, e.sy, e.ex, e.ey, shade(pal, "error", 0.16), 4);
    }
  }
  for (let i = 0; i < pos.length; i++) {
    drawNode(c, pal, pos[i], t, state.now, selectedId !== undefined && pos[i].node.id === selectedId, i);
  }
  return pos;
}
