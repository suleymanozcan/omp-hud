// HUD store: implementation of the HudStore contract from types.ts.
// The `state` object is never replaced (it is updated in place); `version` increases on a real change and subscribers are called.
import {
  FEED_MAX,
  MAX_NODES,
  type CoreStatus,
  type HudCore,
  type HudFeedItem,
  type HudState,
  type HudStore,
  type HudTask,
  type HudTokens,
} from "./types.ts";

const OPTIONAL_NODE_KEYS: Record<string, true> = {
  parentId: true,
  endedAt: true,
  model: true,
  contextTokens: true,
  currentTool: true,
  lastIntent: true,
  retrying: true,
  error: true,
};

function freshTokens(): HudTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, tokPerSec: 0, ctxPct: null };
}

function sameTask(a: HudTask, b: HudTask): boolean {
  return a.phase === b.phase && a.content === b.content && a.status === b.status && a.blocker === b.blocker;
}

export function createStore(): HudStore {
  const start = Date.now();
  const state: HudState = {
    core: { status: "idle", statusSince: start, turn: 0 },
    nodes: [],
    tasks: [],
    tokens: freshTokens(),
    feed: [],
    now: start,
    phase: 0,
  };
  const subs = new Set<() => void>();
  let version = 0;

  function changed(): void {
    version++;
    for (const fn of [...subs]) {
      try {
        fn();
      } catch {
        // a subscriber error must not break the store
      }
    }
  }

  function evictOne(): void {
    let idx = state.nodes.findIndex((n) => n.status !== "running");
    if (idx < 0) idx = 0; // all running: evict the oldest
    state.nodes.splice(idx, 1);
  }

  return {
    state,
    get version() {
      return version;
    },

    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    setCoreStatus(status: CoreStatus, activeTool?: string) {
      const core = state.core;
      if (core.status === status && core.activeTool === activeTool) return;
      if (core.status !== status) core.statusSince = Date.now();
      core.status = status;
      if (activeTool === undefined) delete core.activeTool;
      else core.activeTool = activeTool;
      changed();
    },

    setWarning(w: HudCore["warning"]) {
      if (state.core.warning === w) return;
      if (w === undefined) delete state.core.warning;
      else state.core.warning = w;
      changed();
    },

    incrementTurn() {
      state.core.turn++;
      changed();
    },

    upsertNode(patch) {
      const now = Date.now();
      let node = state.nodes.find((n) => n.id === patch.id);
      let dirty = false;
      if (!node) {
        node = {
          id: patch.id,
          name: patch.id,
          status: "running",
          startedAt: now,
          tokens: 0,
          cost: 0,
          toolCount: 0,
        };
        state.nodes.push(node);
        while (state.nodes.length > MAX_NODES) evictOne();
        dirty = true;
      }
      const target = node as unknown as Record<string, unknown>;
      for (const key of Object.keys(patch)) {
        if (key === "id") continue;
        const value = (patch as unknown as Record<string, unknown>)[key];
        if (value === undefined) {
          if (OPTIONAL_NODE_KEYS[key] && key in target) {
            delete target[key];
            dirty = true;
          }
          continue;
        }
        if (target[key] !== value) {
          target[key] = value;
          dirty = true;
        }
      }
      if (patch.status !== undefined) {
        if (node.status === "running") {
          if (node.endedAt !== undefined && patch.endedAt === undefined) {
            delete node.endedAt;
            dirty = true;
          }
        } else if (node.endedAt === undefined) {
          node.endedAt = now;
          dirty = true;
        }
      }
      if (dirty) changed();
    },

    pushFeed(item: Omit<HudFeedItem, "t"> & { t?: number }) {
      const entry: HudFeedItem = { ...item, t: item.t ?? Date.now() };
      state.feed.push(entry);
      if (state.feed.length > FEED_MAX) state.feed.splice(0, state.feed.length - FEED_MAX);
      changed();
    },

    setTasks(tasks: HudTask[]) {
      const cur = state.tasks;
      if (cur.length === tasks.length && cur.every((t, i) => sameTask(t, tasks[i]!))) return;
      cur.length = 0;
      for (const t of tasks) cur.push({ ...t });
      changed();
    },

    addUsage(u) {
      const tk = state.tokens;
      let dirty = false;
      for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
        const v = u[key];
        if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
          tk[key] += v;
          dirty = true;
        }
      }
      if (dirty) changed();
    },

    setCtxPct(p: number | null) {
      const v = p === null || !Number.isFinite(p) ? null : Math.min(100, Math.max(0, p));
      if (state.tokens.ctxPct === v) return;
      state.tokens.ctxPct = v;
      changed();
    },

    setTokPerSec(v: number) {
      const n = Number.isFinite(v) && v > 0 ? v : 0;
      if (state.tokens.tokPerSec === n) return;
      state.tokens.tokPerSec = n;
      changed();
    },

    tickAnimation(dtMs: number) {
      state.now = Date.now();
      if (Number.isFinite(dtMs) && dtMs > 0) state.phase += dtMs / 1000;
    },

    reset() {
      const now = Date.now();
      const core = state.core;
      core.status = "idle";
      core.statusSince = now;
      core.turn = 0;
      delete core.activeTool;
      delete core.warning;
      state.nodes.length = 0;
      state.tasks.length = 0;
      Object.assign(state.tokens, freshTokens());
      state.feed.length = 0;
      state.now = now;
      changed();
    },
  };
}


