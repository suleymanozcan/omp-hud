// Shared contract between modules (single source of truth for the data shapes).

export const MAX_NODES = 32;
export const FEED_MAX = 100;

export type CoreStatus = "idle" | "thinking" | "streaming" | "tool" | "error" | "done";
export type NodeStatus = "running" | "completed" | "failed" | "aborted";
export type TaskStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
export type FeedKind = "tool" | "message" | "subagent" | "retry" | "error" | "todo" | "system";

export interface HudCore {
  status: CoreStatus;
  statusSince: number; // ms epoch; for animation transitions
  turn: number;
  activeTool?: string;
  warning?: "retry" | "compaction" | "fallback";
}

export interface HudNode {
  id: string;
  name: string; // agent name (e.g. "explore", "task")
  parentId?: string;
  status: NodeStatus;
  startedAt: number;
  endedAt?: number;
  model?: string;
  tokens: number;
  cost: number;
  contextTokens?: number;
  toolCount: number;
  currentTool?: string;
  lastIntent?: string;
  retrying?: boolean;
  error?: string;
}

export interface HudTask {
  phase: string;
  content: string;
  status: TaskStatus;
  blocker?: string;
}

export interface HudFeedItem {
  t: number; // ms epoch
  agent: string; // "main" (the main agent) or a subagent name
  kind: FeedKind;
  text: string; // single line, short
  error?: boolean;
}

export interface HudTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  tokPerSec: number;
  ctxPct: number | null; // 0..100, null when unknown
}

export interface HudState {
  core: HudCore;
  nodes: HudNode[]; // at most MAX_NODES; insertion order is kept (running nodes are not moved first)
  tasks: HudTask[];
  tokens: HudTokens;
  feed: HudFeedItem[]; // at most FEED_MAX, oldest first
  now: number; // ms epoch (updated by tickAnimation)
  phase: number; // animation phase in seconds (float, advanced by tickAnimation)
}

/** omp theme or a test theme. Render code never writes raw colors: it uses only this (raw RGB is allowed when truecolor is set). */
export interface HudTheme {
  fg(color: "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text", text: string): string;
  bold(text: string): string;
  truecolor: boolean;
}

export interface HudStore {
  /** Same object identity for the whole lifetime; contents are updated in place. `version` increases on change. */
  readonly state: HudState;
  readonly version: number;
  subscribe(fn: () => void): () => void; // returns an unsubscribe function; fn must be short and never throw
  setCoreStatus(status: CoreStatus, activeTool?: string): void;
  setWarning(w: HudCore["warning"]): void;
  incrementTurn(): void;
  upsertNode(patch: Partial<HudNode> & { id: string }): void; // creates if missing; past MAX_NODES evicts the oldest finished node
  pushFeed(item: Omit<HudFeedItem, "t"> & { t?: number }): void; // FEED_MAX ring buffer
  setTasks(tasks: HudTask[]): void;
  addUsage(u: Partial<Pick<HudTokens, "input" | "output" | "cacheRead" | "cacheWrite" | "cost">>): void;
  setCtxPct(p: number | null): void;
  setTokPerSec(v: number): void;
  tickAnimation(dtMs: number): void; // advances now and phase; does NOT bump version (redraw requests come from the timer)
  reset(): void;
}

// --- Cross-module exports (signatures are stable) ---
// src/render/orbit-scene.ts : export function renderOrbitScene(state: HudState, width: number, height: number, theme: HudTheme): string[]
//    (exactly `height` rows, every row at most `width` cells wide; core in the center, node orbit around it)
// src/components/full-hud.ts    : export class FullHud (omp Component)   constructor(store: HudStore, theme: HudTheme, requestRender: () => void, close: () => void)
// src/components/compact-hud.ts : export class CompactHud (omp Component) constructor(store: HudStore, theme: HudTheme)
// src/store.ts : export function createStore(): HudStore
// src/collector.ts : export function attachCollector(pi: unknown /* ExtensionAPI */, store: HudStore): void
// index.ts : export default function (pi: ExtensionAPI): void
// src/demo.ts : export class DemoDriver { constructor(store: HudStore); start(): void; stop(): void }  (uses only the HudStore interface)
