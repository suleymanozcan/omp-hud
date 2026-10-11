// /hud demo: a simulated event stream. Uses ONLY the HudStore interface; it never touches omp's real state.
// A ~45 s scenario that restarts when it ends (small seeded randomness on every lap).
// Time: the simulation advances in fixed steps (TICK_MS); timestamps use Date.now()
// (the same clock as the store; the preview script patches Date.now in virtual time).
import type { CoreStatus, HudStore, HudTask } from "./types.ts";
import { MAIN_AGENT, type MsgKey, t } from "./i18n.ts";
import { ct, type ChatKey } from "./chat-i18n.ts";

export interface DemoTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const TICK_MS = 100;
const LAP_MS = 45_000;
const BASE_SEED = 0x4d1a7a;

interface GlobalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

function defaultTimers(): DemoTimers {
  const g = globalThis as unknown as GlobalTimers;
  return {
    setInterval(fn, ms) {
      return g.setInterval(() => {
        try {
          fn();
        } catch {
          // the timer body never throws
        }
      }, ms);
    },
    clearTimer(handle) {
      g.clearInterval(handle);
    },
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  desc: MsgKey;
  model: string;
  tools: string[];
  intents: MsgKey[];
  rate: number; // output tok/s
}

const PROFILES: Record<string, Profile> = {
  explore: {
    desc: "demo.explore.desc",
    model: "haiku",
    tools: ["find", "read", "grep", "read", "ast_grep"],
    intents: ["demo.explore.i1", "demo.explore.i2", "demo.explore.i3"],
    rate: 38,
  },
  scout: {
    desc: "demo.scout.desc",
    model: "haiku",
    tools: ["read", "grep", "bash", "read"],
    intents: ["demo.scout.i1", "demo.scout.i2"],
    rate: 30,
  },
  task: {
    desc: "demo.task.desc",
    model: "sonnet",
    tools: ["read", "edit", "edit", "bash", "write", "edit"],
    intents: ["demo.task.i1", "demo.task.i2", "demo.task.i3"],
    rate: 64,
  },
  reviewer: {
    desc: "demo.reviewer.desc",
    model: "sonnet",
    tools: ["read", "grep", "lsp", "read"],
    intents: ["demo.reviewer.i1", "demo.reviewer.i2"],
    rate: 46,
  },
  test: {
    desc: "demo.test.desc",
    model: "haiku",
    tools: ["bash", "read", "bash", "grep"],
    intents: ["demo.test.i1", "demo.test.i2"],
    rate: 34,
  },
  plan: {
    desc: "demo.plan.desc",
    model: "sonnet",
    tools: ["read", "grep", "edit", "read"],
    intents: ["demo.plan.i1", "demo.plan.i2"],
    rate: 52,
  },
};

const CROWD_NAMES = ["explore", "scout", "task", "test"];
const FILES = [
  "src/store.ts",
  "src/collector.ts",
  "src/render/ring.ts",
  "src/render/core.ts",
  "src/components/full-hud.ts",
  "src/util/text.ts",
  "index.ts",
  "package.json",
];
const PATTERNS = ["upsertNode", "tickAnimation", "HudState", "MAX_NODES", "setWidget", "requestRender"];
const MAIN_TOOLS = ["read", "grep", "find", "read", "ast_grep"];

const MAIN_RATE: Record<CoreStatus, number> = {
  idle: 0,
  thinking: 26,
  streaming: 88,
  tool: 5,
  error: 0,
  done: 0,
};

const PRICE = { input: 3, output: 15, cacheRead: 0.3 }; // USD / 1M

interface Action {
  at: number;
  run: () => void;
}

interface Sim {
  id: string;
  name: string;
  profile: Profile;
  active: boolean;
  startLap: number;
  endLap: number;
  period: number; // update once every this many ticks
  rateMul: number;
  tokens: number;
  cost: number;
  toolCount: number;
  tool?: string;
  intent?: string;
  nextToolLap: number;
  toolGap: number;
  feedTools: boolean;
  ctx0: number;
  ctx1: number;
}

interface SpawnOpts {
  id: string;
  name: string;
  startMs: number;
  durMs: number;
  desc?: () => string;
  period?: number;
  feedTools?: boolean;
  /** End status; defaults to completed. */
  end?: "completed" | "failed" | "aborted";
  error?: () => string;
}

export class DemoDriver {
  private readonly store: HudStore;
  private readonly timers: DemoTimers;
  private handle: unknown;
  private running = false;

  private lap = -1;
  private lapT = 0;
  private tickNo = 0;
  private rand: () => number = mulberry32(BASE_SEED);
  private actions: Action[] = [];
  private ptr = 0;
  private sims: Sim[] = [];
  private mode: CoreStatus = "idle";
  private smoothRate = 0;
  private acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

  constructor(store: HudStore, timers?: DemoTimers) {
    this.store = store;
    this.timers = timers ?? defaultTimers();
  }

  start(): void {
    this.stop();
    this.store.reset();
    this.lap = -1;
    this.running = true;
    this.beginLap();
    this.runDue();
    this.handle = this.timers.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.handle !== undefined) {
      const h = this.handle;
      this.handle = undefined;
      try {
        this.timers.clearTimer(h);
      } catch {
        // ignore
      }
    }
  }

  // --- time loop ---

  private tick(): void {
    if (!this.running) return;
    try {
      this.tickNo++;
      this.lapT += TICK_MS;
      if (this.lapT >= LAP_MS) {
        this.store.reset();
        this.beginLap();
      }
      this.runDue();
      this.simulate();
    } catch {
      // the demo never takes the session down
    }
  }

  private runDue(): void {
    const a = this.actions;
    while (this.ptr < a.length && a[this.ptr]!.at <= this.lapT) {
      const act = a[this.ptr++]!;
      try {
        act.run();
      } catch {
        // one action's error does not break the flow
      }
    }
  }

  private beginLap(): void {
    this.lap++;
    this.lapT = 0;
    this.ptr = 0;
    this.mode = "idle";
    this.smoothRate = 0;
    this.acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    this.rand = mulberry32(BASE_SEED + this.lap * 7919);
    this.build();
  }

  private core(status: CoreStatus, tool?: string): void {
    this.mode = status;
    this.store.setCoreStatus(status, tool);
  }

  private feed(agent: string, kind: "tool" | "message" | "subagent" | "retry" | "error" | "todo" | "system", text: string, error?: boolean): void {
    this.store.pushFeed({ agent, kind, text, ...(error ? { error: true } : {}) });
  }

  // --- scenario ---

  /** Conversation for the full-screen demo: fixed times and texts, and NO random draws (the rest of the scenario must not change). */
  private buildChat(at: (ms: number, run: () => void) => void, lap: number): void {
    const store = this.store;
    const STEP_MS = 350;
    const say = (key: ChatKey, ms: number): void => {
      at(ms, () => store.addChat({ id: `d${lap}-${key}`, role: "user", text: ct(key) }));
    };
    // The reply grows in steps (the text is translated when it starts, like a real stream).
    const reply = (key: ChatKey, from: number, to: number): void => {
      const id = `d${lap}-${key}`;
      let full = "";
      at(from, () => {
        full = ct(key);
        store.addChat({ id, role: "assistant", text: full.slice(0, 1), streaming: true });
      });
      const steps = Math.max(1, Math.floor((to - from) / STEP_MS));
      for (let k = 1; k <= steps; k++) {
        at(from + k * STEP_MS, () => store.updateChat(id, { text: full.slice(0, Math.ceil((full.length * k) / steps)) }));
      }
      at(to, () => store.updateChat(id, { text: full, streaming: false }));
    };
    say("demo.chat.u1", 500);
    reply("demo.chat.a1", 1500, 8500);
    say("demo.chat.u2", 11000);
    reply("demo.chat.a2", 12000, 16500);
    // A message sent while the agent is busy waits as `after` until omp reports it.
    at(20000, () => store.addChat({ id: `d${lap}-q`, role: "user", text: ct("demo.chat.u3"), pending: "after" }));
    at(25000, () => store.updateChat(`d${lap}-q`, { pending: null }));
    reply("demo.chat.a3", 26000, 29000);
  }

  private build(): void {
    const store = this.store;
    const r = this.rand;
    const lap = this.lap;
    const actions: Action[] = [];
    this.actions = actions;
    this.sims = [];

    const jit = (ms: number): number => (r() * 2 - 1) * ms;
    const ri = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
    const at = (ms: number, run: () => void): void => {
      actions.push({ at: Math.max(0, Math.round(ms)), run });
    };
    const sec = (s: number, j = 250): number => s * 1000 + jit(j);

    // tasks: 9 in one lap, 8 in the next. Texts are catalog keys; they are translated at display time.
    const defs: Array<[MsgKey, MsgKey]> = [
      ["demo.phase.discover", "demo.task.1"],
      ["demo.phase.discover", "demo.task.2"],
      ["demo.phase.discover", "demo.task.3"],
      ["demo.phase.build", "demo.task.4"],
      ["demo.phase.build", "demo.task.5"],
      ["demo.phase.build", "demo.task.6"],
      ["demo.phase.verify", "demo.task.7"],
      ["demo.phase.verify", "demo.task.8"],
      ["demo.phase.verify", "demo.task.9"],
    ];
    const lastIdx = lap % 2 === 0 ? 8 : 7;
    const tasks: HudTask[] = defs.slice(0, lastIdx + 1).map(([phase, content]) => ({ phase: t(phase), content: t(content), status: "pending" }));
    const snapshot = (): HudTask[] => tasks.map((x, i) => ({ ...x, phase: t(defs[i]![0]), content: t(defs[i]![1]) }));
    const setTask = (i: number, status: HudTask["status"], blocker?: string): void => {
      const task = tasks[i];
      if (!task) return;
      task.status = status;
      if (blocker !== undefined) task.blocker = blocker;
      else delete task.blocker;
      store.setTasks(snapshot());
      this.feed(MAIN_AGENT, "todo", `${t(defs[i]![1])}: ${taskStateText(status)}`, false);
    };
    const taskTimes: Array<[number, number, number]> = [
      // [task, start s, end s]
      [0, 1.2, 6.5],
      [1, 6.5, 11.5],
      [2, 11.5, 16.0],
      [3, 16.0, 19.5],
      [4, 19.5, 23.5],
      [5, 23.5, 27.0],
      [6, 27.0, 33.0],
    ];
    for (const [i, s, e] of taskTimes) {
      at(sec(s, 200), () => setTask(i, "in_progress"));
      at(sec(e, 200), () => setTask(i, "completed"));
    }

    // opening
    at(0, () => {
      this.core("thinking");
      store.incrementTurn();
      store.setCtxPct(20);
      store.setTasks(snapshot());
      this.feed(MAIN_AGENT, "system", t("demo.lapStart", { n: lap + 1 }));
    });

    // main agent: tool calls
    for (let i = 0; i < 5; i++) {
      const when = sec(1.6 + i * 1.25, 120);
      const tool = MAIN_TOOLS[(i + lap) % MAIN_TOOLS.length]!;
      const arg = tool === "grep" || tool === "ast_grep" ? `"${pick(PATTERNS)}"` : pick(FILES);
      at(when, () => {
        this.core("tool", tool);
        this.feed(MAIN_AGENT, "tool", `${tool} ${arg}`);
      });
      at(when + ri(700, 1000), () => this.core("thinking"));
    }

    // streaming
    at(sec(8.0, 150), () => {
      this.core("streaming");
      store.incrementTurn();
      this.feed(MAIN_AGENT, "message", t("demo.planReady"));
    });

    this.buildChat(at, lap);
    // subagents
    const sims: Sim[] = [];
    const spawn = (o: SpawnOpts): Sim => {
      const profile = PROFILES[o.name] ?? PROFILES.task!;
      const startLap = Math.max(0, Math.round(o.startMs));
      const endLap = startLap + Math.round(o.durMs);
      const total = ri(4, 9);
      const sim: Sim = {
        id: o.id,
        name: o.name,
        profile,
        active: false,
        startLap,
        endLap,
        period: o.period ?? 1,
        rateMul: (0.75 + r() * 0.5) * (o.period && o.period > 1 ? 0.2 : 1), // crowd nodes are light
        tokens: 0,
        cost: 0,
        toolCount: 0,
        nextToolLap: startLap + 300 + ri(0, 500),
        toolGap: Math.max(400, o.durMs / total),
        feedTools: o.feedTools ?? true,
        ctx0: ri(6000, 14000),
        ctx1: ri(32000, 90000),
      };
      sims.push(sim);
      const descText = o.desc ?? (() => t(profile.desc));
      at(startLap, () => {
        sim.active = true;
        sim.intent = t(pick(profile.intents));
        store.upsertNode({
          id: sim.id,
          name: sim.name,
          status: "running",
          startedAt: Date.now(),
          model: profile.model,
          tokens: 0,
          cost: 0,
          toolCount: 0,
          contextTokens: sim.ctx0,
          lastIntent: sim.intent,
        });
        this.feed(sim.name, "subagent", t("demo.subStarted", { desc: descText() }));
      });
      at(endLap, () => {
        sim.active = false;
        const status = o.end ?? "completed";
        store.upsertNode({
          id: sim.id,
          status,
          endedAt: Date.now(),
          currentTool: undefined,
          retrying: undefined,
          lastIntent: status === "completed" ? t("demo.intentDone") : sim.intent,
          tokens: Math.round(sim.tokens),
          cost: Math.round(sim.cost * 10000) / 10000,
          toolCount: sim.toolCount,
          ...(o.error ? { error: o.error() } : {}),
        });
        if (status === "completed") this.feed(sim.name, "subagent", t("demo.subDone", { tools: sim.toolCount, tokens: Math.round(sim.tokens) }));
        else if (status === "failed") this.feed(sim.name, "error", t("demo.subFailed", { err: o.error ? o.error() : t("demo.unknownError") }), true);
        else this.feed(sim.name, "subagent", t("sub.aborted"));
      });
      return sim;
    };

    const t9 = sec(9.0, 150);
    at(t9, () => this.core("tool", "task"));
    spawn({ id: `d${lap}-explore`, name: "explore", startMs: t9, durMs: sec(8.5, 600) });
    spawn({ id: `d${lap}-scout`, name: "scout", startMs: sec(9.6, 150), durMs: sec(7.5, 600) });
    spawn({ id: `d${lap}-task`, name: "task", startMs: sec(10.3, 150), durMs: sec(15, 800) });

    // second wave: the reviewer fails
    const rev = spawn({
      id: `d${lap}-reviewer`,
      name: "reviewer",
      startMs: sec(15.0, 200),
      durMs: sec(7.0, 400),
      end: "failed",
      error: () => t("demo.timeout"),
    });
    at(rev.endLap - 2500, () => {
      store.setWarning("retry");
      store.upsertNode({ id: rev.id, retrying: true, lastIntent: t("demo.intentRetry") });
      this.feed("reviewer", "retry", t("demo.retryFeed"), false);
    });
    at(rev.endLap, () => {
      store.setWarning(undefined);
      this.core("error", "task");
      setTask(7, "blocked", t("demo.blocker"));
    });
    at(rev.endLap + 1500, () => this.core("tool", "task"));
    spawn({ id: `d${lap}-test`, name: "test", startMs: sec(16.5, 200), durMs: sec(9.5, 500) });
    spawn({ id: `d${lap}-plan`, name: "plan", startMs: sec(17.5, 200), durMs: sec(9.5, 500) });

    // the reviewer is restarted and completes; the blocker is lifted
    const rev2 = spawn({
      id: `d${lap}-reviewer2`,
      name: "reviewer",
      startMs: Math.max(rev.endLap + 2000, sec(24.0, 200)),
      durMs: sec(8.0, 400),
      desc: () => t("demo.rereview"),
    });
    at(rev2.endLap, () => setTask(7, "in_progress"));
    at(rev2.endLap + 3500, () => setTask(7, "completed"));

    // crowd: short-lived, fast nodes; every third lap exceeds the 32-node limit
    const overflow = lap % 3 === 2;
    const crowd = overflow ? ri(27, 29) : ri(16, 20);
    const gap = overflow ? 120 : 150;
    const crowdStart = sec(26.5, 200);
    at(crowdStart, () => this.feed(MAIN_AGENT, "system", t("demo.crowd", { n: crowd })));
    for (let i = 0; i < crowd; i++) {
      const name = CROWD_NAMES[i % CROWD_NAMES.length]!;
      const life = ri(2000, 4500);
      spawn({
        id: `d${lap}-c${i}`,
        name,
        startMs: crowdStart + i * gap,
        durMs: life,
        desc: () => t("demo.chunk", { n: i + 1 }),
        period: 3,
        feedTools: false,
        end: i % 9 === 4 ? "aborted" : "completed",
      });
    }

    // wrap-up and finish
    let lastEnd = 0;
    for (const s of sims) lastEnd = Math.max(lastEnd, s.endLap);
    const doneAt = Math.max(lastEnd + 4500, 40_500);
    at(lastEnd + 500, () => this.core("thinking"));
    at(lastEnd + 1300, () => {
      this.core("streaming");
      store.incrementTurn();
      this.feed(MAIN_AGENT, "message", t("demo.merging"));
    });
    at(Math.max(lastEnd + 2200, sec(36.5, 100)), () => setTask(8, "in_progress"));
    at(Math.max(lastEnd + 3800, sec(39.0, 100)), () => setTask(8, "completed"));
    at(doneAt, () => {
      this.core("done");
      store.setWarning(undefined);
      this.feed(MAIN_AGENT, "message", t("demo.finished", { n: sims.length }));
    });

    this.sims = sims;
    this.actions.sort((a, b) => a.at - b.at);
  }

  // --- continuous updates ---

  private simulate(): void {
    const store = this.store;
    const r = this.rand;
    const lapT = this.lapT;
    const dt = TICK_MS / 1000;
    const acc = this.acc;
    let rate = MAIN_RATE[this.mode] * (0.85 + 0.3 * r());

    // main agent usage
    const mainOut = rate * dt;
    this.accum(mainOut);

    for (const s of this.sims) {
      if (!s.active) continue;
      if ((this.tickNo + s.startLap) % s.period !== 0) {
        rate += s.profile.rate * s.rateMul;
        continue;
      }
      const sdt = dt * s.period;
      const out = s.profile.rate * s.rateMul * (0.6 + 0.8 * r()) * sdt;
      rate += s.profile.rate * s.rateMul;
      s.tokens += out * 3;
      s.cost += (out * 2 * PRICE.input + out * PRICE.output + out * 8 * PRICE.cacheRead) / 1e6;
      this.accum(out);
      if (lapT >= s.nextToolLap) {
        s.toolCount++;
        s.tool = s.profile.tools[(s.toolCount - 1) % s.profile.tools.length]!;
        s.nextToolLap = lapT + s.toolGap * (0.7 + 0.6 * r());
        if (s.toolCount % 3 === 0) s.intent = t(s.profile.intents[s.toolCount % s.profile.intents.length]!);
        if (s.feedTools) {
          const isGrep = s.tool === "grep" || s.tool === "ast_grep";
          const arg = isGrep ? `"${PATTERNS[(s.toolCount + s.startLap) % PATTERNS.length]!}"` : s.tool === "bash" ? "bun test" : FILES[(s.toolCount + s.startLap) % FILES.length]!;
          this.feed(s.name, "tool", `${s.tool} ${arg}`);
        }
      }
      const p = Math.min(1, Math.max(0, (lapT - s.startLap) / Math.max(1, s.endLap - s.startLap)));
      store.upsertNode({
        id: s.id,
        tokens: Math.round(s.tokens),
        cost: Math.round(s.cost * 10000) / 10000,
        toolCount: s.toolCount,
        currentTool: s.tool,
        lastIntent: s.intent,
        contextTokens: Math.round(s.ctx0 + (s.ctx1 - s.ctx0) * p),
      });
    }

    // counters: integer deltas
    const dIn = Math.floor(acc.input);
    const dOut = Math.floor(acc.output);
    const dCr = Math.floor(acc.cacheRead);
    const dCw = Math.floor(acc.cacheWrite);
    if (dIn || dOut || dCr || dCw) {
      const cost = (dIn * PRICE.input + dOut * PRICE.output + dCr * PRICE.cacheRead + dCw * 3.75) / 1e6;
      store.addUsage({ input: dIn, output: dOut, cacheRead: dCr, cacheWrite: dCw, cost });
      acc.input -= dIn;
      acc.output -= dOut;
      acc.cacheRead -= dCr;
      acc.cacheWrite -= dCw;
    }

    if (this.tickNo % 5 === 0) {
      this.smoothRate = this.smoothRate * 0.6 + rate * 0.4;
      store.setTokPerSec(this.smoothRate < 0.5 ? 0 : Math.round(this.smoothRate));
      store.setCtxPct(ctxPct(lapT));
    }
  }

  private accum(out: number): void {
    const a = this.acc;
    a.output += out;
    a.input += out * 2.2;
    a.cacheRead += out * 9;
    a.cacheWrite += out * 0.8;
  }
}

function ctxPct(lapT: number): number {
  if (lapT < 300) return 20;
  const p = Math.min(1, (lapT - 300) / 37_700);
  const wobble = p < 1 ? Math.sin(lapT / 1700) * 0.8 : 0;
  return Math.round((20 + 50 * p + wobble) * 10) / 10;
}

function taskStateText(s: HudTask["status"]): string {
  switch (s) {
    case "in_progress":
      return t("demo.taskState.in_progress");
    case "completed":
      return t("demo.taskState.completed");
    case "blocked":
      return t("demo.taskState.blocked");
    case "abandoned":
      return t("demo.taskState.abandoned");
    default:
      return t("demo.taskState.pending");
  }
}
