// Smoke script (NOT a permanent test): exercises the collector and index.ts with a fake pi/ctx.
// Run: bun scripts/smoke-collector.ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { detectLang, getLang, isLangAuto, setLang } from "../src/i18n.ts";
import { installPiTuiShim } from "./shim-pi-tui.ts";
import { FEED_MAX, MAX_NODES, type HudStore } from "../src/types.ts";

setLang("en"); // assertions below pin English; the Turkish side is covered in the /hud lang block
installPiTuiShim();
// Dynamic import: the shim must be installed BEFORE "@oh-my-pi/pi-tui" is resolved; a static import would be hoisted above it.
const { createStore } = await import("../src/store.ts");
const { attachCollector } = await import("../src/collector.ts");
const { default: hudExtension } = await import("../index.ts");
const { dockHeightFor } = await import("../src/components/dock-hud.ts");

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---------------------------------------------------------------- fake pi / ctx
type Handler = (event: unknown, ctx: unknown) => unknown;
type Cmd = { handler: (args: string, ctx: unknown) => Promise<void> | void };

function makePi() {
  const handlers = new Map<string, Handler[]>();
  const channels = new Map<string, Array<(p: unknown) => void>>();
  const commands = new Map<string, Cmd>();
  const sent: Array<{ text: string; deliverAs?: string }> = [];
  const pi = {
    on(event: string, fn: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    registerCommand(name: string, cmd: Cmd) {
      commands.set(name, cmd);
    },
    sendUserMessage(text: string, options?: { deliverAs?: string }) {
      sent.push({ text, deliverAs: options?.deliverAs });
    },
    events: {
      on(channel: string, fn: (p: unknown) => void) {
        const list = channels.get(channel) ?? [];
        list.push(fn);
        channels.set(channel, list);
        return () => {
          const l = channels.get(channel) ?? [];
          const i = l.indexOf(fn);
          if (i >= 0) l.splice(i, 1);
        };
      },
    },
  };
  return {
    pi: pi as unknown as ExtensionAPI,
    commands,
    handlerCount: (event: string) => handlers.get(event)?.length ?? 0,
    sent,
    channelCount: (channel: string) => channels.get(channel)?.length ?? 0,
    async emit(event: string, payload: unknown, ctx: unknown) {
      for (const fn of handlers.get(event) ?? []) await fn(payload, ctx);
    },
    bus(channel: string, payload: unknown) {
      for (const fn of [...(channels.get(channel) ?? [])]) fn(payload);
    },
  };
}

interface TimerRec {
  fn: () => void;
  ms: number;
  active: boolean;
}

function makeCtx(opts: { agent?: Record<string, unknown>; hasUI?: boolean; mode?: string; ctxPercent?: number; branch?: unknown[] } = {}) {
  const timers: TimerRec[] = [];
  const widgets: Array<{ key: string; content: unknown; options?: { placement?: string } }> = [];
  const notes: string[] = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  const tui = { renders: 0, requestRender() { this.renders++; }, terminal: { rows: 24, columns: 100 } };
  const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
  const custom: { factory?: (...a: unknown[]) => { render(w: number): readonly string[]; dispose?(): void }; done?: (r: unknown) => void; options?: { overlay?: boolean; overlayOptions?: { fullscreen?: boolean } }; opened: number } = { opened: 0 };
  const idle = { value: true };
  const ctx = {
    hasUI: opts.hasUI ?? true,
    mode: opts.mode ?? "tui",
    cwd: "/tmp",
    agent: opts.agent ?? { kind: "main", id: "main", name: "main", depth: 0 },
    sessionManager: { getBranch: (): unknown[] => opts.branch ?? [] },
    getContextUsage: (): { tokens: number; contextWindow: number; percent: number } | undefined => (opts.ctxPercent === undefined ? undefined : { tokens: 10, contextWindow: 100, percent: opts.ctxPercent }),
    isIdle: () => idle.value,
    setInterval(fn: () => void, ms: number) {
      timers.push({ fn, ms, active: true });
      return timers.length - 1;
    },
    setTimeout() {
      return -1;
    },
    clearTimer(h: unknown) {
      const t = timers[h as number];
      if (t) t.active = false;
    },
    ui: {
      setWidget(key: string, content: unknown, options?: { placement?: string }) {
        widgets.push({ key, content, options });
      },
      notify(message: string) {
        notes.push(message);
      },
      setStatus(key: string, text: string | undefined) {
        statuses.push({ key, text });
      },
      custom(factory: (...a: unknown[]) => { render(w: number): readonly string[]; dispose?(): void }, options: { overlay?: boolean; overlayOptions?: { fullscreen?: boolean } }) {
        custom.factory = factory;
        custom.options = options;
        custom.opened++;
        const { promise, resolve } = Promise.withResolvers<unknown>();
        custom.done = resolve;
        return promise;
      },
    },
  };
  return {
    ctx,
    idle,
    tui,
    theme,
    custom,
    widgets,
    statuses,
    notes,
    activeMs: () => timers.filter((t) => t.active).map((t) => t.ms),
    fire: (ms: number) => timers.filter((t) => t.active && t.ms === ms).forEach((t) => t.fn()),
  };
}

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

// ---------------------------------------------------------------- 1) store
console.log("[store]");
{
  const s = createStore();
  const v0 = s.version;
  s.setCoreStatus("idle");
  s.addUsage({});
  s.addUsage({ input: 0 });
  s.setCtxPct(null);
  s.setTokPerSec(0);
  s.setWarning(undefined);
  s.setTasks([]);
  s.tickAnimation(100);
  check("same value does not bump version", s.version === v0, s.version);
  check("tickAnimation advances the phase", Math.abs(s.state.phase - 0.1) < 1e-9, s.state.phase);
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.setCoreStatus("thinking");
  check("real change: subscriber + version", calls === 1 && s.version === v0 + 1);
  const since = s.state.core.statusSince;
  s.setCoreStatus("tool", "read");
  check("statusSince/activeTool", s.state.core.activeTool === "read" && s.state.core.statusSince >= since);
  off();
  s.setCoreStatus("done");
  check("unsubscribe", calls === 2, calls);
  s.upsertNode({ id: "a", name: "explore" });
  s.upsertNode({ id: "a", status: "completed" });
  const a = s.state.nodes[0]!;
  check("node is created + endedAt", a.name === "explore" && a.status === "completed" && typeof a.endedAt === "number");
  s.upsertNode({ id: "a", status: "running" });
  check("endedAt is cleared when a node returns to running", s.state.nodes[0]!.endedAt === undefined);
  const stateRef = s.state;
  for (let i = 0; i < FEED_MAX + 10; i++) s.pushFeed({ agent: "main", kind: "system", text: `x${i}` });
  check("FEED_MAX ring buffer", s.state.feed.length === FEED_MAX && s.state.feed[0]!.text === "x10", s.state.feed.length);
  for (let i = 0; i < MAX_NODES + 8; i++) s.upsertNode({ id: `n${i}`, status: i % 2 ? "completed" : "running" });
  check("MAX_NODES limit", s.state.nodes.length === MAX_NODES, s.state.nodes.length);
  s.reset();
  check("reset in place", s.state === stateRef && s.state.feed.length === 0 && s.state.nodes.length === 0 && s.state.core.status === "idle");
}

// ---------------------------------------------------------------- 2) collector (direct)
console.log("[collector: main agent]");
const store: HudStore = createStore();
const h = makePi();
attachCollector(h.pi, store);
const main = makeCtx({ ctxPercent: 42.5, branch: [
  { message: { toolName: "bash", details: {} } },
  { message: { toolName: "todo", details: { phases: [{ name: "Phase1", tasks: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] }] } } },
] });
const C = main.ctx;
const st = store.state;

await h.emit("session_start", {}, C);
check("session_start: todos are rebuilt from history", st.tasks.length === 2 && st.tasks[0]!.phase === "Phase1" && st.tasks[1]!.status === "in_progress", st.tasks);
check("pi.events subscriptions", h.channelCount("task:subagent:lifecycle") === 1 && h.channelCount("task:subagent:progress") === 1);
check("no registration for tool_call", h.handlerCount("tool_call") === 0);

await h.emit("agent_start", {}, C);
check("agent_start -> thinking", st.core.status === "thinking");
await h.emit("turn_start", {}, C);
check("turn_start -> turn=1", st.core.turn === 1 && st.core.status === "thinking");
await h.emit("message_start", { message: { role: "assistant" } }, C);
await h.emit("message_update", { message: { role: "assistant" } }, C);
check("message_update -> streaming", st.core.status === "streaming");
await sleep(80);
await h.emit("message_end", { message: { role: "assistant", usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, cost: { total: 0.01 } } } }, C);
check("message_end: usage", st.tokens.input === 100 && st.tokens.output === 50 && st.tokens.cacheRead === 10 && st.tokens.cacheWrite === 5 && Math.abs(st.tokens.cost - 0.01) < 1e-9, st.tokens);
check("message_end: tok/s > 0", st.tokens.tokPerSec > 0 && st.tokens.tokPerSec < 2000, st.tokens.tokPerSec);
check("thinking after message_end", st.core.status === "thinking");

await h.emit("tool_execution_start", { toolCallId: "t1", toolName: "read", intent: "reading the file" }, C);
check("tool start -> tool", st.core.status === "tool" && st.core.activeTool === "read");
check("feed: tool: intent", st.feed.at(-1)?.text === "read: reading the file" && st.feed.at(-1)?.kind === "tool", st.feed.at(-1));
await h.emit("tool_execution_start", { toolCallId: "t2", toolName: "grep" }, C);
await h.emit("tool_execution_end", { toolCallId: "t2", toolName: "grep", isError: false }, C);
check("parallel tools: the remaining tool is shown", st.core.status === "tool" && st.core.activeTool === "read", st.core);
await h.emit("tool_execution_end", { toolCallId: "t1", toolName: "read", isError: false }, C);
check("tool end -> thinking", st.core.status === "thinking" && st.core.activeTool === undefined);
await h.emit("tool_execution_start", { toolCallId: "t3", toolName: "bash", intent: "build" }, C);
await h.emit("tool_execution_end", { toolCallId: "t3", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "exit 1:\nboom" }] } }, C);
const errItem = st.feed.at(-1);
check("error: feed error:true", errItem?.error === true && /bash: error: exit 1: boom/.test(errItem.text), errItem);

await h.emit("tool_result", { toolName: "todo", details: { phases: [
  { name: "Phase1", tasks: [{ content: "a", status: "completed" }, { content: "b", status: "completed" }] },
  { name: "Phase2", tasks: [{ content: "c", status: "blocked", blocker: "wait" }, { content: "d", status: "weird" }] },
] } }, C);
check("todo tool_result is flattened", st.tasks.length === 4 && st.tasks[2]!.phase === "Phase2" && st.tasks[2]!.blocker === "wait" && st.tasks[3]!.status === "pending", st.tasks);
await h.emit("tool_result", { toolName: "read", details: { phases: [] } }, C);
check("other tools do not clobber the todos", st.tasks.length === 4);

await h.emit("auto_retry_start", { attempt: 1, maxAttempts: 3, errorMessage: "429 limit" }, C);
check("retry: warning + feed", st.core.warning === "retry" && st.feed.at(-1)?.kind === "retry" && st.feed.at(-1)!.text.includes("(1/3)"), st.feed.at(-1));
await h.emit("auto_retry_end", { success: true, attempt: 1 }, C);
check("retry end clears the warning", st.core.warning === undefined);
await h.emit("retry_fallback_applied", { from: "a/x", to: "b/y" }, C);
check("fallback warning", st.core.warning === "fallback" && st.feed.at(-1)!.text.includes("b/y"));
await h.emit("auto_compaction_start", { reason: "threshold", action: "context-full" }, C);
check("compaction warning", st.core.warning === "compaction");
await h.emit("auto_compaction_end", { aborted: false }, C);
check("compaction end", st.core.warning === undefined);

await h.emit("turn_end", {}, C);
check("turn_end -> ctxPct", st.tokens.ctxPct === 42.5, st.tokens.ctxPct);

await h.emit("agent_end", { messages: [{ role: "user" }, { role: "assistant", stopReason: "stop" }] }, C);
check("agent_end -> done", st.core.status === "done");
await h.emit("agent_start", {}, C);
await h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] }, C);
check("agent_end (error) -> error", st.core.status === "error");

console.log("[collector: subagents / pi.events]");
h.bus("task:subagent:lifecycle", { id: "s1", agent: "explore", status: "started", index: 0, description: "scan the code", parentToolCallId: "p" });
let n1 = st.nodes.find((n) => n.id === "s1");
check("started -> running", n1?.status === "running" && n1.name === "explore", n1);
check("subagent feed line", st.feed.at(-1)?.kind === "subagent" && st.feed.at(-1)!.agent === "explore" && st.feed.at(-1)!.text.includes("scan the code"), st.feed.at(-1));
h.bus("task:subagent:progress", { index: 0, agent: "explore", progress: { id: "s1", status: "running", tokens: 1200, cost: 0.02, contextTokens: 5000, toolCount: 3, currentTool: "grep", currentToolIntent: "searching pattern", retryState: { attempt: 1 } } });
n1 = st.nodes.find((n) => n.id === "s1");
check("progress: counters", n1?.tokens === 1200 && n1.cost === 0.02 && n1.contextTokens === 5000 && n1.toolCount === 3 && n1.currentTool === "grep" && n1.lastIntent === "searching pattern", n1);
check("progress: retryState -> retrying", n1?.retrying === true);
h.bus("task:subagent:progress", { index: 0, agent: "explore", progress: { id: "s1", status: "running", tokens: 1300 } });
n1 = st.nodes.find((n) => n.id === "s1");
check("progress: missing field -> cleared", n1?.tokens === 1300 && n1.currentTool === undefined && n1.retrying === undefined, n1);
h.bus("task:subagent:lifecycle", { id: "s1", agent: "explore", status: "completed", index: 0 });
n1 = st.nodes.find((n) => n.id === "s1");
check("completed + endedAt", n1?.status === "completed" && typeof n1.endedAt === "number", n1);
h.bus("task:subagent:progress", { index: 0, agent: "explore", progress: { id: "s1", tokens: 1400 } });
check("late progress does not reopen the status", st.nodes.find((n) => n.id === "s1")?.status === "completed");
h.bus("task:subagent:lifecycle", { id: "s2", agent: "task", status: "started", index: 1 });
h.bus("task:subagent:lifecycle", { id: "s2", agent: "task", status: "failed", index: 1, error: "model died" });
const n2 = st.nodes.find((n) => n.id === "s2");
check("failed + error", n2?.status === "failed" && n2.error === "model died", n2);
check("failed feed error:true", st.feed.at(-1)?.error === true && st.feed.at(-1)?.kind === "subagent", st.feed.at(-1));
h.bus("task:subagent:lifecycle", { id: "s3", status: "started", index: 5 });
h.bus("task:subagent:lifecycle", { id: "s3", status: "aborted", index: 5 });
const n3 = st.nodes.find((n) => n.id === "s3");
check("aborted + no name -> subagent-N (language independent)", n3?.status === "aborted" && n3.name === "subagent-6", n3);
const feedLen = st.feed.length;
h.bus("task:subagent:lifecycle", { id: "s3", status: "aborted", index: 5 });
check("same status does not duplicate the feed line", st.feed.length === feedLen);
const nodeCount = st.nodes.length;
for (const junk of [undefined, null, 5, "x", {}, { status: "started" }, { id: 7, status: "bogus" }]) {
  h.bus("task:subagent:lifecycle", junk);
  h.bus("task:subagent:progress", junk);
}
check("malformed payload creates no node / does not throw", st.nodes.length === nodeCount, st.nodes.length);

console.log("[collector: resilience]");
{
  const events = ["session_start", "session_switch", "session_shutdown", "agent_start", "agent_end", "turn_start", "turn_end", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_end", "tool_result", "auto_retry_start", "auto_retry_end", "retry_fallback_applied", "auto_compaction_start", "auto_compaction_end"];
  let threw: string | undefined;
  const bad = makeCtx({ hasUI: true });
  bad.ctx.getContextUsage = () => { throw new Error("unavailable"); };
  bad.ctx.sessionManager = { getBranch: () => { throw new Error("unavailable"); } };
  for (const ev of events) {
    for (const payload of [undefined, null, {}, 42]) {
      try {
        await h.emit(ev, payload, bad.ctx);
      } catch (e) {
        threw = `${ev}: ${String(e)}`;
      }
    }
  }
  check("empty/malformed event + throwing ctx: handlers do not throw", threw === undefined, threw);
}
await h.emit("session_shutdown", {}, C);
check("session_shutdown drops the subscriptions", h.channelCount("task:subagent:lifecycle") === 0 && h.channelCount("task:subagent:progress") === 0);

console.log("[collector: ctx.agent fallback path]");
{
  const s2 = createStore();
  const h2 = makePi();
  attachCollector(h2.pi, s2);
  const sub = makeCtx({ agent: { kind: "sub", id: "x1", name: "task", depth: 1, parentId: "p0" } });
  await h2.emit("session_start", {}, sub.ctx);
  s2.setCoreStatus("thinking");
  const since = s2.state.core.statusSince;
  await h2.emit("agent_start", {}, sub.ctx);
  await h2.emit("tool_execution_start", { toolCallId: "a", toolName: "read", intent: "read" }, sub.ctx);
  const n = s2.state.nodes.find((x) => x.id === "x1");
  check("fallback path: node id/name/parentId", n?.name === "task" && n.parentId === "p0" && n.status === "running" && n.currentTool === "read" && n.toolCount === 1 && n.lastIntent === "read", n);
  await h2.emit("tool_execution_end", { toolCallId: "a", toolName: "read" }, sub.ctx);
  await h2.emit("message_end", { message: { role: "assistant", usage: { totalTokens: 300, cost: { total: 0.5 } } } }, sub.ctx);
  const n2b = s2.state.nodes.find((x) => x.id === "x1");
  check("fallback path: tokens/cost land on the node", n2b?.tokens === 300 && n2b.cost === 0.5 && n2b.currentTool === undefined, n2b);
  check("fallback path: main status/turn/tokens are unchanged", s2.state.core.status === "thinking" && s2.state.core.statusSince === since && s2.state.tokens.output === 0 && s2.state.core.turn === 0);
  await h2.emit("agent_end", { messages: [] }, sub.ctx);
  check("fallback path: agent_end -> completed", s2.state.nodes.find((x) => x.id === "x1")?.status === "completed");
  check("a subagent session does not subscribe to the bus", h2.channelCount("task:subagent:lifecycle") === 0);
}

// ---------------------------------------------------------------- 3) index.ts
console.log("[index.ts]");
const idx = makePi();
hudExtension(idx.pi);
check("/hud command is registered", idx.commands.has("hud"));
check("no registration for tool_call", idx.handlerCount("tool_call") === 0);
const cmd = idx.commands.get("hud")!;

{
  const off = makeCtx({ hasUI: false });
  await idx.emit("session_start", {}, off.ctx);
  await cmd.handler("", off.ctx);
  check("hasUI=false: nothing is set up", off.widgets.length === 0 && off.activeMs().length === 0 && off.custom.opened === 0);
  const nontui = makeCtx({ mode: "print" });
  await idx.emit("session_start", {}, nontui.ctx);
  check("mode != tui: nothing is set up", nontui.widgets.length === 0 && nontui.activeMs().length === 0);
  const sub = makeCtx({ agent: { kind: "sub", id: "q", name: "task", depth: 1 } });
  await idx.emit("session_start", {}, sub.ctx);
  check("a subagent session does not set up the HUD", sub.widgets.length === 0 && sub.activeMs().length === 0);
}

const M = makeCtx();
await idx.emit("session_start", {}, M.ctx);
const wDock = M.widgets.at(-1);
check("dock is ON by default (aboveEditor, key hud-dock)", wDock?.key === "hud-dock" && typeof wDock.content === "function" && wDock.options?.placement === "aboveEditor", wDock);
check("status line is written at start", M.statuses.at(-1)?.key === "hud" && M.statuses.at(-1)?.text === "hud ○ ready", M.statuses.at(-1));
check("idle dock: 250 ms timer", M.activeMs().join() === "250", M.activeMs());
if (typeof wDock?.content !== "function") throw new Error("no dock widget factory");
const dock = (wDock.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] })(M.tui, M.theme);
const dockRows = dock.render(100);
check("dock render: dockHeightFor rows (default large on a 24-row terminal = 10, 45% cap), width <= 100", dockRows.length === dockHeightFor("large", 24) && dockRows.length === 10 && dockRows.every((l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length <= 100), dockRows.length);
check(
  "dockHeightFor: small 8 / medium 12 / large 16 (45% cap, floor 4, 4-6 below 20 rows)",
  [8, 12, 16].join() === (["small", "medium", "large"] as const).map((s) => dockHeightFor(s, 45)).join() &&
    [8, 10, 10].join() === (["small", "medium", "large"] as const).map((s) => dockHeightFor(s, 24)).join() &&
    [4, 5, 6].join() === (["small", "medium", "large"] as const).map((s) => dockHeightFor(s, 19)).join() &&
    [4, 4, 4].join() === (["small", "medium", "large"] as const).map((s) => dockHeightFor(s, 8)).join() &&
    dockHeightFor("large", Number.NaN) === 4,
);

// size / place
{
  const placed = (key: string, placement: string): boolean => M.widgets.at(-1)?.key === key && M.widgets.at(-1)?.options?.placement === placement;
  await cmd.handler("size small", M.ctx);
  check("/hud size small: note + 8 rows", M.notes.at(-1)?.startsWith("Dock size: small") === true && dock.render(100).length === 8, M.notes.at(-1));
  await cmd.handler("size huge", M.ctx);
  check("/hud size huge: usage, size unchanged", M.notes.at(-1) === "Usage: /hud size small|medium|large" && dock.render(100).length === 8, M.notes.at(-1));
  await cmd.handler("size large", M.ctx);
  check("/hud size large: capped at 45% of 24 rows = 10", dock.render(100).length === dockHeightFor("large", 24) && dockHeightFor("large", 24) === 10);
  await cmd.handler("size medium", M.ctx);
  await cmd.handler("place below", M.ctx);
  check("/hud place below: dock re-installed belowEditor", placed("hud-dock", "belowEditor") && M.widgets.at(-2)?.content === undefined && M.notes.at(-1) === "Dock place: below the editor", [M.widgets.at(-1), M.notes.at(-1)]);
  const below = (M.widgets.at(-1)!.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] })(M.tui, M.theme);
  check("below the editor the dock gets the bottom padding (10 + 1 rows)", below.render(100).length === 11, below.render(100).length);
  await cmd.handler("place sideways", M.ctx);
  check("/hud place sideways: usage", M.notes.at(-1) === "Usage: /hud place above|below", M.notes.at(-1));
  await cmd.handler("place above", M.ctx);
  check("/hud place above: back above the editor, no padding", placed("hud-dock", "aboveEditor") && M.notes.at(-1) === "Dock place: above the editor", M.notes.at(-1));
  const above = (M.widgets.at(-1)!.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] })(M.tui, M.theme);
  check("above the editor the dock has exactly dockHeightFor rows", above.render(100).length === 10, above.render(100).length);
  await cmd.handler("", M.ctx);
  check("/hud closes the dock: widget removed, note, no timers", M.widgets.at(-1)?.content === undefined && M.notes.at(-1)?.startsWith("HUD dock: off") === true && M.activeMs().length === 0, [M.notes.at(-1), M.activeMs()]);
  await cmd.handler("", M.ctx);
  check("/hud opens it again", placed("hud-dock", "aboveEditor") && M.notes.at(-1) === "HUD dock: on (medium, above the editor)", M.notes.at(-1));
  await cmd.handler("compact on", M.ctx);
}
const w0 = M.widgets.at(-1);
check("/hud compact on: compact widget (key hud, belowEditor), dock closed", w0?.key === "hud" && typeof w0.content === "function" && w0.options?.placement === "belowEditor" && M.notes.at(-1)?.includes("the dock was closed") === true, w0);
if (typeof w0?.content !== "function") throw new Error("no compact widget factory");
// The only known factory signature: (tui, theme) => Component; called with fake objects.
const widgetFactory = w0.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] };
const compact = widgetFactory(M.tui, M.theme);
const rows0 = compact.render(100);
check("compact render: rows <= width", rows0.length > 0 && rows0.every((l) => /^[^\x1b]*$/.test(l.replace(/\x1b\[[0-9;]*m/g, "")) && [...l.replace(/\x1b\[[0-9;]*m/g, "")].length <= 100), rows0.length);
check("idle compact: 500 ms timer", M.activeMs().join() === "500", M.activeMs());

await idx.emit("agent_start", {}, M.ctx);
check("agent busy: 125 ms (the old timer is cleared)", M.activeMs().join() === "125", M.activeMs());
const rendersBefore = M.tui.renders;
M.fire(125);
check("tick calls requestRender", M.tui.renders > rendersBefore);
await idx.emit("tool_execution_start", { toolCallId: "z", toolName: "bash", intent: "x" }, M.ctx);
const rows1 = compact.render(100);
check("compact changes with the status", rows1 !== rows0 && rows1.join("\n") !== rows0.join("\n"));

await idx.emit("session_switch", {}, M.ctx);
check("session_switch: widget is set up again", M.widgets.length >= 2);

await cmd.handler("help", M.ctx);
check("/hud help: English help names lang command + env var", M.notes.at(-1)?.includes("/hud demo") === true && M.notes.at(-1)!.includes("commands") && M.notes.at(-1)!.includes("/hud lang") && M.notes.at(-1)!.includes("OMP_HUD_LANG"), M.notes.at(-1));
await cmd.handler("xyz", M.ctx);
check("unknown subcommand warns", M.notes.at(-1)?.includes("Unknown subcommand") === true);
check("/hud help names the dock commands", ["/hud full", "/hud size", "/hud place", "OMP_HUD_SIZE", "OMP_HUD_PLACE", "OMP_HUD_PAD"].every((s) => M.notes.at(-2)?.includes(s)), M.notes.at(-2));
await cmd.handler("doctor", M.ctx);
check("/hud doctor: dock, demo, compact, status, screen, store and timer lines; no environment dump", ["omp-hud doctor", "version:", "dock: off", "demo: not running", "compact widget: on", "status line:", "screen: rows 24", "store:", "timer:"].every((s) => M.notes.at(-1)?.includes(s)) && !/CMUX|PATH=|HOME=/.test(M.notes.at(-1) ?? ""), M.notes.at(-1));

// /hud lang: runtime language switch redraws the compact widget
{
  const plain = (ls: readonly string[]): string => ls.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  check("compact (en): ready", plain(compact.render(100)).includes("ready"), plain(compact.render(100)));
  const rendersBeforeLang = M.tui.renders;
  await cmd.handler("lang tr", M.ctx);
  check("/hud lang tr: note + redraw request", M.notes.at(-1) === "Dil: tr (elle)" && M.tui.renders > rendersBeforeLang, M.notes.at(-1));
  check("compact turns Turkish without new events", plain(compact.render(100)).includes("hazır") && !plain(compact.render(100)).includes("ready"), plain(compact.render(100)));
  await cmd.handler("help", M.ctx);
  check("/hud help (tr) names lang command + env var", M.notes.at(-1)?.includes("komutları") === true && M.notes.at(-1)!.includes("/hud lang") && M.notes.at(-1)!.includes("OMP_HUD_LANG"), M.notes.at(-1));
  await cmd.handler("lang xx", M.ctx);
  check("/hud lang xx: usage, language unchanged", M.notes.at(-1) === "Kullanım: /hud lang [tr|en|auto]" && getLang() === "tr", M.notes.at(-1));
  await cmd.handler("lang en", M.ctx);
  check("/hud lang en", M.notes.at(-1) === "Language: en (manual)" && plain(compact.render(100)).includes("ready"), M.notes.at(-1));
  await cmd.handler("lang", M.ctx);
  check("/hud lang: shows current without changing", M.notes.at(-1) === "Language: en (manual)" && getLang() === "en");
  await cmd.handler("lang auto", M.ctx);
  check("/hud lang auto: follows environment again", isLangAuto() && getLang() === detectLang() && /\((auto|otomatik)\)$/.test(M.notes.at(-1) ?? ""), M.notes.at(-1));
  setLang("en");

  // detectLang: OMP_HUD_LANG > LC_ALL > LC_MESSAGES > LANG; default en
  const names = ["OMP_HUD_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] as const;
  const saved = names.map((n) => process.env[n]);
  const envSet = (o: Partial<Record<(typeof names)[number], string>>): void => {
    for (const n of names) delete process.env[n];
    for (const [k, v] of Object.entries(o)) process.env[k] = v;
  };
  envSet({});
  const d0 = detectLang();
  envSet({ LANG: "tr_TR.UTF-8" });
  const d1 = detectLang();
  envSet({ LANG: "en_US.UTF-8" });
  const d2 = detectLang();
  envSet({ LANG: "tr_TR.UTF-8", LC_ALL: "en_US.UTF-8" });
  const d3 = detectLang();
  envSet({ LC_ALL: "tr_TR.UTF-8", OMP_HUD_LANG: "en" });
  const d4 = detectLang();
  envSet({ LANG: "de_DE.UTF-8", OMP_HUD_LANG: "tr" });
  const d5 = detectLang();
  envSet({ LANG: "tr_TR.UTF-8", OMP_HUD_LANG: "fr" });
  const d6 = detectLang();
  names.forEach((n, i) => {
    if (saved[i] === undefined) delete process.env[n];
    else process.env[n] = saved[i];
  });
  check("detectLang: no locale -> en; tr locale -> tr; en locale -> en", d0 === "en" && d1 === "tr" && d2 === "en", [d0, d1, d2]);
  check("detectLang: LC_ALL beats LANG; OMP_HUD_LANG beats locale; bad value ignored", d3 === "en" && d4 === "en" && d5 === "tr" && d6 === "tr", [d3, d4, d5, d6]);
}

await cmd.handler("status", M.ctx);
check("/hud status: reports the state", M.notes.at(-1)?.startsWith("HUD status line: on") === true, M.notes.at(-1));
await cmd.handler("status maybe", M.ctx);
check("/hud status maybe: usage", M.notes.at(-1) === "Usage: /hud status [on|off]", M.notes.at(-1));
await cmd.handler("status off", M.ctx);
check("/hud status off: entry removed", M.statuses.at(-1)?.key === "hud" && M.statuses.at(-1)?.text === undefined && M.notes.at(-1) === "HUD status line: off", M.statuses.at(-1));
await cmd.handler("compact off", M.ctx);
check("/hud compact off: widget removed, no timers", M.widgets.at(-1)?.content === undefined && M.activeMs().length === 0 && M.notes.at(-1) === "Compact HUD: off", M.activeMs());
await cmd.handler("compact", M.ctx);
check("/hud compact: toggle turns it on", typeof M.widgets.at(-1)?.content === "function" && M.activeMs().length === 1 && M.notes.at(-1) === "Compact HUD: on (1-3 lines below the editor)", M.notes.at(-1));
await cmd.handler("compact on", M.ctx);
check("/hud compact on while on: already on", M.notes.at(-1) === "Compact HUD: already on (re-applied)", M.notes.at(-1));
await cmd.handler("compact off", M.ctx);
await idx.emit("agent_start", {}, M.ctx); // the session_switch above reset the store: busy again for the timer checks below
await cmd.handler("status on", M.ctx);
check("/hud status on: text written, status-only busy timer is 500 ms", M.statuses.at(-1)?.text?.startsWith("hud ") === true && M.activeMs().join() === "500", [M.statuses.at(-1), M.activeMs()]);
await cmd.handler("status on", M.ctx);
check("/hud status on again: already on", M.notes.at(-1) === "HUD status line: already on", M.notes.at(-1));
await cmd.handler("status off", M.ctx);
check("/hud status off: no timers again", M.activeMs().length === 0, M.activeMs());

// full screen (real store)
{
  const p = cmd.handler("full", M.ctx);
  check("/hud: custom overlay + fullscreen option", M.custom.opened === 1 && M.custom.options?.overlay === true && M.custom.options.overlayOptions?.fullscreen === true, M.custom.options);
  check("full screen: 66 ms", M.activeMs().join() === "66", M.activeMs());
  let closed = false;
  const full = M.custom.factory!(M.tui, M.theme, {}, (r: unknown) => { closed = true; M.custom.done!(r); });
  const lines = full.render(100);
  check("FullHud render: about 24 rows, width <= 100", lines.length > 0 && lines.length <= 24 && lines.every((l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length <= 100), lines.length);
  M.fire(66);
  M.custom.done!(undefined);
  await p;
  full.dispose?.();
  check("timers are cleaned up on close", M.activeMs().length === 0 && closed === false, M.activeMs());
}

// dock again, now with a busy store: timers, demo in the dock, exclusivity with compact
{
  const opened = M.custom.opened;
  await cmd.handler("", M.ctx);
  check("/hud toggles the dock back on (busy store: 125 ms)", M.widgets.at(-1)?.key === "hud-dock" && M.activeMs().join() === "125", [M.widgets.at(-1)?.key, M.activeMs()]);
  await cmd.handler("demo", M.ctx);
  const dockDemo = M.widgets.at(-1);
  check("/hud demo: runs in the dock, no overlay", M.custom.opened === opened && dockDemo?.key === "hud-dock" && typeof dockDemo.content === "function" && M.notes.at(-1)?.startsWith("Demo running in the dock") === true, M.notes.at(-1));
  check("demo: dock timer + driver timer", M.activeMs().length === 2 && M.activeMs().includes(125), M.activeMs());
  const demoDock = (dockDemo!.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] })(M.tui, M.theme);
  M.fire(100);
  M.fire(100);
  check("demo dock renders its own store", demoDock.render(100).length === dockHeightFor("medium", 24));
  await cmd.handler("demo", M.ctx);
  check("/hud demo again stops it: driver timer gone, dock back on the real store", M.notes.at(-1) === "Demo stopped" && M.activeMs().join() === "125" && M.widgets.at(-1)?.key === "hud-dock", [M.notes.at(-1), M.activeMs()]);
  await cmd.handler("demo off", M.ctx);
  check("/hud demo off without a demo says so", M.notes.at(-1) === "No demo is running", M.notes.at(-1));
  await cmd.handler("demo nope", M.ctx);
  check("/hud demo nope: usage", M.notes.at(-1) === "Usage: /hud demo [off|full]", M.notes.at(-1));
  await cmd.handler("demo", M.ctx);
  await cmd.handler("", M.ctx);
  check("/hud while a demo runs: dock and demo are both gone", M.widgets.at(-1)?.content === undefined && M.activeMs().length === 0, [M.widgets.at(-1)?.key, M.activeMs()]);
  await cmd.handler("demo", M.ctx);
  await cmd.handler("demo off", M.ctx);
  check("/hud demo opened the dock only for the demo: demo off closes it again", M.widgets.at(-1)?.key === "hud-dock" && M.widgets.at(-1)?.content === undefined && M.activeMs().length === 0, [M.widgets.at(-1), M.activeMs()]);
  await cmd.handler("", M.ctx);
  await cmd.handler("compact on", M.ctx);
  check("/hud compact on closes the dock", M.notes.at(-1)?.includes("the dock was closed") === true && M.widgets.at(-1)?.key === "hud" && M.widgets.at(-2)?.key === "hud-dock" && M.widgets.at(-2)?.content === undefined, M.notes.at(-1));
  await cmd.handler("", M.ctx);
  check("/hud opens the dock and closes compact", M.notes.at(-1)?.includes("the compact panel was closed") === true && M.widgets.at(-1)?.key === "hud-dock" && M.widgets.at(-2)?.key === "hud" && M.widgets.at(-2)?.content === undefined, M.notes.at(-1));
  await cmd.handler("compact off", M.ctx);
  check("/hud compact off while compact is off: already off, dock untouched", M.notes.at(-1) === "Compact HUD: already off" && M.widgets.at(-1)?.key === "hud-dock" && M.widgets.at(-1)?.content !== undefined, M.notes.at(-1));
  await cmd.handler("", M.ctx);
}

// demo
{
  const rowsBeforeDemo = compact.render(100).join("\n");
  const p = cmd.handler("demo full", M.ctx);
  check("/hud demo full opens the full screen", M.custom.opened === 2, M.custom.opened);
  const ms = M.activeMs().sort((a, b) => a - b);
  check("demo: driver timer + 66 ms", ms.includes(66) && ms.length === 2, ms);
  const demoFull = M.custom.factory!(M.tui, M.theme, {}, (r: unknown) => M.custom.done!(r));
  M.fire(100);
  M.fire(100);
  check("demo: render", demoFull.render(100).length > 0);
  M.custom.done!(undefined);
  await p;
  demoFull.dispose?.();
  check("after the demo closes, stop(): no timers left", M.activeMs().length === 0, M.activeMs());
  check("demo does not disturb the real store", compact.render(100).join("\n") === rowsBeforeDemo);
}

// ---------------------------------------------------------------- 4) full screen chat
console.log("[chat: store]");
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
{
  const s = createStore();
  const id = s.addChat({ role: "user", text: "hello \x1b[31mred\x1b[0m\x07\x1b]0;title\x07 ok" });
  check("chat: ANSI and control characters are removed", s.state.chat?.[0]?.text === "hello red ok", s.state.chat?.[0]?.text);
  const v = s.version;
  const rev = s.state.chatRev ?? 0;
  s.updateChat(id, { text: "hello red ok!" });
  check("chat: a text update bumps chatRev but not the store version", s.version === v && (s.state.chatRev ?? 0) === rev + 1, [s.version, v]);
  s.updateChat(id, { pending: "after" });
  check("chat: a pending change bumps the version", s.version === v + 1);
  for (let i = 0; i < 45; i++) s.addChat({ role: "assistant", text: `m${i}` });
  check("chat: ring buffer keeps 40 messages", s.state.chat?.length === 40 && s.state.chat[39]?.text === "m44", s.state.chat?.length);
  const big = s.addChat({ role: "assistant", text: "a".repeat(30000) });
  const bigMsg = s.state.chat?.find((m) => m.id === big);
  check("chat: a very long message is clipped (head and tail kept)", (bigMsg?.text.length ?? 0) <= 12 * 1024 && bigMsg?.text.includes("\n…\n") === true, bigMsg?.text.length);
  const s2 = createStore();
  s2.addChat({ role: "user", text: "queued one", pending: "after" });
  s2.addChat({ role: "assistant", text: "reply", streaming: true });
  check("chat: resolvePending matches by text (whitespace-insensitive)", s2.resolvePendingChat("  queued   one "));
  check("chat: a resolved message moves behind the running reply and loses its tag", s2.state.chat?.at(-1)?.text === "queued one" && s2.state.chat.at(-1)?.pending === undefined, s2.state.chat?.map((m) => m.text));
  check("chat: resolvePending without a match is false", !s2.resolvePendingChat("nope"));
  s2.addChat({ role: "user", text: "stale", pending: "after", t: Date.now() - 10_000 });
  s2.addChat({ role: "user", text: "fresh", pending: "after" });
  s2.expirePendingChat(3000);
  check("chat: expirePending drops only old pending messages", s2.state.chat?.some((m) => m.text === "stale") === false && s2.state.chat.some((m) => m.text === "fresh"));
  s2.reset();
  check("chat: reset empties the conversation", s2.state.chat?.length === 0);
}

console.log("[chat: collector]");
{
  const s = createStore();
  const h = makePi();
  attachCollector(h.pi, s);
  const c = makeCtx({
    branch: [
      { type: "message", message: { role: "user", content: "hi there" } },
      { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "hello!" }, { type: "toolCall", name: "read" }] } },
      { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] } },
      { type: "custom_message", content: "ignored" },
    ],
  });
  await h.emit("session_start", {}, c.ctx);
  const texts = s.state.chat?.map((m) => `${m.role}:${m.text}`);
  check("session_start loads user/assistant text from the branch (no thinking, tool results or custom entries)", texts?.join("|") === "user:hi there|assistant:hello!", texts);
  s.addChat({ role: "user", text: "typed in the HUD", pending: "sending" });
  const before = s.state.chat?.length;
  await h.emit("message_start", { message: { role: "user", content: [{ type: "text", text: "typed in the HUD" }] } }, c.ctx);
  check("a user message that omp reports resolves the pending one (no duplicate)", s.state.chat?.length === before && s.state.chat?.at(-1)?.pending === undefined, s.state.chat?.map((m) => m.text));
  await h.emit("message_start", { message: { role: "user", content: "from the editor" } }, c.ctx);
  check("a user message from the editor is added", s.state.chat?.at(-1)?.text === "from the editor");
  await h.emit("message_start", { message: { role: "assistant", content: [] } }, c.ctx);
  const n0 = s.state.chat?.length;
  await h.emit("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }] } }, c.ctx);
  check("thinking blocks never reach the chat", s.state.chat?.length === n0);
  await h.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "Hel" }] } }, c.ctx);
  const a = s.state.chat?.at(-1);
  check("first streamed text creates a streaming assistant message", a?.role === "assistant" && a.text === "Hel" && a.streaming === true, a);
  const v = s.version;
  await h.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "Hello wor" }] } }, c.ctx);
  check("streaming updates are coalesced (~8 Hz) and do not bump the store version", s.state.chat?.at(-1)?.text === "Hel" && s.version === v, [s.state.chat?.at(-1)?.text, s.version - v]);
  await sleep(140);
  await h.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "Hello wor" }] } }, c.ctx);
  check("an update after the coalescing window is applied", s.state.chat?.at(-1)?.text === "Hello wor");
  await h.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "Hello world" }, { type: "toolCall", name: "read" }] } }, c.ctx);
  const done = s.state.chat?.at(-1);
  check("message_end writes the full text and stops streaming", done?.text === "Hello world" && done.streaming === false, done);
  const n1 = s.state.chat?.length;
  await h.emit("message_start", { message: { role: "assistant", content: [] } }, c.ctx);
  await h.emit("message_update", { message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] } }, c.ctx);
  await h.emit("message_end", { message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] } }, c.ctx);
  check("an assistant message with tool calls only leaves no trace", s.state.chat?.length === n1, s.state.chat?.length);
  const subCtx = makeCtx({ agent: { kind: "sub", id: "x", name: "task", depth: 1 } }).ctx;
  await h.emit("message_start", { message: { role: "user", content: "subagent prompt" } }, subCtx);
  check("subagent messages are not shown", s.state.chat?.length === n1);
  s.addChat({ role: "user", text: "never reported", pending: "after", t: Date.now() - 10_000 });
  await h.emit("agent_end", { messages: [] }, c.ctx);
  check("agent_end drops stale pending messages", s.state.chat?.some((m) => m.text === "never reported") === false);
  await h.emit("session_switch", {}, c.ctx);
  check("session_switch resets and reloads the conversation", s.state.chat?.length === 2, s.state.chat?.length);
}

console.log("[chat: every message once]");
{
  const mk = async (branch: unknown[] = []) => {
    const s = createStore();
    const h = makePi();
    attachCollector(h.pi, s);
    const c = makeCtx({ branch });
    await h.emit("session_start", {}, c.ctx);
    const play = async (events: Array<[string, unknown]>) => {
      for (const [name, payload] of events) await h.emit(name, payload, c.ctx);
    };
    const rows = () => (s.state.chat ?? []).map((m) => `${m.role}:${m.text}${m.streaming ? ":streaming" : ""}${m.pending ? `:${m.pending}` : ""}`);
    return { s, h, c, play, rows };
  };
  const text = (t: string) => [{ type: "text", text: t }];
  const A = (t: string | undefined, ts: number, ...extra: unknown[]) => ({ role: "assistant", content: [...(t === undefined ? [] : text(t)), ...extra], timestamp: ts });
  const U = (t: string, ts: number) => ({ role: "user", content: text(t), timestamp: ts });
  const call = { type: "toolCall", name: "bash" };
  // What real omp 18.8.9 emits for one text turn (captured in a pty run): the custom reminder, the user message,
  // the assistant message start, two updates, the end, and one more update AFTER the end.
  const textTurn = (q: string, a: string, ts: number): Array<[string, unknown]> => [
    ["agent_start", {}],
    ["message_start", { message: { role: "custom", content: "<system-reminder>x</system-reminder>" } }],
    ["message_end", { message: { role: "custom", content: "<system-reminder>x</system-reminder>" } }],
    ["message_start", { message: U(q, ts) }],
    ["message_end", { message: U(q, ts) }],
    ["turn_start", {}],
    ["message_start", { message: A(undefined, ts + 1) }],
    ["message_update", { message: A(a.slice(0, 2), ts + 1) }],
    ["message_update", { message: A(a, ts + 1) }],
    ["message_end", { message: A(a, ts + 1) }],
    ["message_update", { message: A(a, ts + 1) }],
    ["turn_end", {}],
    ["agent_end", { messages: [] }],
  ];
  {
    const t = await mk();
    await t.play(textTurn("ping", "pong", 10));
    check("a text turn (omp sends a message_update after message_end): question and answer once, in order", t.rows().join("|") === "user:ping|assistant:pong", t.rows());
    await t.play(textTurn("ping", "pong", 20));
    check("the same words asked again are a new turn, not a duplicate", t.rows().join("|") === "user:ping|assistant:pong|user:ping|assistant:pong", t.rows());
  }
  {
    const t = await mk();
    await t.play([
      ["agent_start", {}],
      ["message_start", { message: U("run it", 30) }],
      ["message_end", { message: U("run it", 30) }],
      ["turn_start", {}],
      ["message_start", { message: A(undefined, 31) }],
      ["message_update", { message: A("Checking first.", 31, call) }],
      ["message_end", { message: A("Checking first.", 31, call) }],
      ["message_update", { message: A("Checking first.", 31, call) }],
      ["tool_execution_start", { toolCallId: "t1", toolName: "bash" }],
      ["tool_execution_end", { toolCallId: "t1", toolName: "bash" }],
      ["message_start", { message: { role: "toolResult", content: text("out") } }],
      ["message_end", { message: { role: "toolResult", content: text("out") } }],
      ["turn_end", {}],
      ["turn_start", {}],
      ["message_start", { message: A(undefined, 32) }],
      ["message_update", { message: A("All done.", 32) }],
      ["message_end", { message: A("All done.", 32) }],
      ["message_update", { message: A("All done.", 32) }],
    ]);
    await sleep(140);
    await t.play([
      ["message_update", { message: A("All done.", 32) }],
      ["turn_end", {}],
      ["agent_end", { messages: [] }],
    ]);
    check("a turn with a tool call: each assistant message once, in order, nothing left streaming", t.rows().join("|") === "user:run it|assistant:Checking first.|assistant:All done.", t.rows());
    const t2 = await mk();
    await t2.play([
      ["message_start", { message: A(undefined, 80) }],
      ["message_update", { message: A("x", 80) }],
      ["message_end", { message: A("x", 80) }],
    ]);
    t2.s.setCoreStatus("thinking");
    await t2.play([["message_update", { message: A("x", 80) }]]);
    check("a message_update after message_end does not put the core back to streaming", t2.s.state.core.status === "thinking", t2.s.state.core.status);
  }
  {
    const t = await mk();
    await t.play([
      ["agent_start", {}],
      ["message_start", { message: U("tools only", 40) }],
      ["message_start", { message: A(undefined, 41) }],
      ["message_update", { message: A(undefined, 41, call) }],
      ["message_end", { message: A(undefined, 41, call) }],
      ["message_update", { message: A(undefined, 41, call) }],
      ["agent_end", { messages: [] }],
    ]);
    check("a message with tool calls only leaves nothing, even with a late update", t.rows().join("|") === "user:tools only", t.rows());
  }
  {
    const t = await mk([
      { type: "message", message: U("old question", 100) },
      { type: "message", message: { ...A("old answer", 101) } },
    ]);
    check("history loads the earlier turn", t.rows().join("|") === "user:old question|assistant:old answer", t.rows());
    await t.play([
      ["message_start", { message: U("old question", 100) }],
      ["message_start", { message: A(undefined, 101) }],
      ["message_update", { message: A("old answer", 101) }],
      ["message_end", { message: A("old answer", 101) }],
      ["message_update", { message: A("old answer", 101) }],
      ["agent_end", { messages: [] }],
    ]);
    check("history followed by the live events of the same messages: no copies", t.rows().join("|") === "user:old question|assistant:old answer", t.rows());
    await t.play(textTurn("next", "fresh", 200));
    check("a new turn after that is appended once", t.rows().join("|") === "user:old question|assistant:old answer|user:next|assistant:fresh", t.rows());
  }
  {
    const t = await mk();
    await t.play([
      ["message_update", { message: A("joined mid-stream", 50) }],
      ["message_end", { message: A("joined mid-stream", 50) }],
      ["message_end", { message: A("joined mid-stream", 50) }],
      ["message_update", { message: A("joined mid-stream", 50) }],
    ]);
    check("an extension that joins mid-stream shows the message once (updates without a start are ignored, a repeated end too)", t.rows().join("|") === "assistant:joined mid-stream", t.rows());
  }
  {
    const t = await mk();
    await t.play([
      ["message_start", { message: A(undefined, 60) }],
      ["message_update", { message: A("cut off", 60) }],
      ["message_start", { message: A(undefined, 61) }],
      ["message_update", { message: A("second", 61) }],
    ]);
    check("a message that never ended is closed when the next one starts", t.rows().join("|") === "assistant:cut off|assistant:second:streaming", t.rows());
    await t.play([["agent_end", { messages: [] }]]);
    check("agent_end closes the last streaming message", t.rows().join("|") === "assistant:cut off|assistant:second", t.rows());
  }
  {
    // A follow-up typed in the HUD while the agent is busy stays behind the running reply, also when that reply's late update arrives.
    const t = await mk();
    t.s.addChat({ role: "user", text: "one", pending: "sending" });
    await t.play([
      ["agent_start", {}],
      ["message_start", { message: U("one", 70) }],
      ["message_start", { message: A(undefined, 71) }],
      ["message_update", { message: A("answer one", 71) }],
    ]);
    t.s.addChat({ role: "user", text: "two", pending: "after" });
    t.s.addChat({ role: "user", text: "three", pending: "steer" });
    await t.play([
      ["message_end", { message: A("answer one", 71) }],
      ["message_update", { message: A("answer one", 71) }],
    ]);
    check("queued messages stay behind the running reply (a late update does not open an entry behind them)", t.rows().join("|") === "user:one|assistant:answer one|user:two:after|user:three:steer", t.rows());
    await t.play([
      ["message_start", { message: U("two", 72) }],
      ["message_start", { message: A(undefined, 73) }],
      ["message_update", { message: A("answer two", 73) }],
      ["message_end", { message: A("answer two", 73) }],
      ["message_update", { message: A("answer two", 73) }],
      ["message_start", { message: U("three", 74) }],
      ["message_start", { message: A(undefined, 75) }],
      ["message_update", { message: A("answer three", 75) }],
      ["message_end", { message: A("answer three", 75) }],
      ["message_update", { message: A("answer three", 75) }],
      ["agent_end", { messages: [] }],
    ]);
    check("queued and steered messages appear in the order omp runs them, each once", t.rows().join("|") === "user:one|assistant:answer one|user:two|assistant:answer two|user:three|assistant:answer three", t.rows());
  }
}

console.log("[chat: input line]");
const { InputLine } = await import("../src/components/input-line.ts");
const { renderChat } = await import("../src/render/chat.ts");
const { FullHud } = await import("../src/components/full-hud.ts");
const { newChatView } = await import("../src/chat.ts");
const { vw } = await import("../src/util/text.ts");
const tagTheme = { fg: (c: string, t: string) => `<${c}>${t}</${c}>`, bold: (t: string) => t, truecolor: false };
const noTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, truecolor: false };
{
  const typeIn = (l: InstanceType<typeof InputLine>, s: string) => {
    for (const ch of s) l.handleInput(ch);
  };
  const l = new InputLine();
  typeIn(l, "merhaba ğüşiöç");
  check("input: typed text with Turkish letters", l.text === "merhaba ğüşiöç", l.text);
  l.handleInput("\x1b[D");
  l.handleInput("\x1b[D");
  l.handleInput("X");
  check("input: left, left, insert", l.text === "merhaba ğüşiXöç", l.text);
  l.handleInput("\x7f");
  l.handleInput("\x1b[3~");
  check("input: backspace and delete", l.text === "merhaba ğüşiç", l.text);
  l.handleInput("\x1b[H");
  l.handleInput(">");
  check("input: Home then insert", l.text === ">merhaba ğüşiç");
  l.handleInput("\x05");
  l.handleInput("\x17");
  check("input: Ctrl+E then Ctrl+W deletes the last word", l.text === ">merhaba ", l.text);
  l.handleInput("\x15");
  check("input: Ctrl+U clears the line", l.isEmpty);
  const r1 = l.handleInput("\x1b[200~a\nb\tc\x1b[201~");
  check("input: bracketed paste is one edit, line breaks become spaces", r1.kind === "edit" && l.text === "a b c", l.text);
  l.clear();
  l.handleInput("\x1b[200~ab");
  check("input: a paste split over chunks is read as text, not keys", l.pasting && l.text === "");
  const r2 = l.handleInput("\t\x1b[201~\r");
  check("input: the end of a split paste, then Enter in the same chunk, submits", r2.kind === "submit" && r2.text === "ab" && !l.pasting, [r2, l.text]);
  typeIn(l, "one");
  l.handleInput("\r");
  typeIn(l, "two");
  const sub = l.handleInput("\x1b\r");
  check("input: Enter submits as steer, Alt+Enter submits as after-yield", sub.kind === "submit" && sub.text === "two" && sub.mode === "after" && l.isEmpty, sub);
  typeIn(l, "draft");
  l.handleInput("\x1b[A");
  check("input: Up recalls the newest history entry", l.text === "two");
  l.handleInput("\x1b[A");
  check("input: Up again goes further back", l.text === "one");
  l.handleInput("\x1b[B");
  l.handleInput("\x1b[B");
  check("input: Down returns to the draft", l.text === "draft", l.text);
  check("input: an unknown sequence is left to the owner", l.handleInput("\x1b[99~").kind === "none");
  l.clear();
  l.handleInput("\x1b[97u");
  l.handleInput("\x1b[98;2u");
  check("input: kitty printable keys", l.text === "aB", l.text);
  l.clear();
  typeIn(l, "x".repeat(120));
  const row = l.render(40, noTheme, "ph");
  check("input: render is exactly the width and shows the end with the cursor", vw(row) === 40 && row.includes("\x1b[7m \x1b[27m") && row.startsWith("❯ …"), [vw(row), row]);
  for (let i = 0; i < 90; i++) l.handleInput("\x1b[D");
  const mid = l.render(40, noTheme, "ph");
  check("input: with the cursor in the middle the row stays exactly the width, cursor visible", vw(mid) === 40 && mid.includes("\x1b[7mx\x1b[27m"), mid);
  l.handleInput("\x01");
  const head = l.render(40, noTheme, "ph");
  check("input: Home scrolls back to the start (no left mark, a right mark)", vw(head) === 40 && !head.includes("…") === false && head.startsWith("❯ \x1b[7mx") && head.endsWith("…"), head);
  l.clear();
  check("input: empty line shows the placeholder", plain(l.render(30, noTheme, "type here")).startsWith("❯  type here"));
  l.restore("kept");
  check("input: restore puts text back", l.text === "kept");
}

console.log("[chat: panel]");
{
  const s = createStore();
  const empty = renderChat(s.state, 40, 6, tagTheme);
  check("chat panel: empty state text, exactly height rows", empty.length === 6 && plain(empty[0]!).includes("no messages yet"), empty[0]);
  s.addChat({ role: "user", text: "How do I do this? " + "word ".repeat(30) });
  s.addChat({
    role: "assistant",
    text: "# Title\n\nSome **bold** text and a list:\n\n- first item that is long enough to wrap around the panel width\n1. numbered\n\n```ts\nconst veryLongCodeLine = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);\n```\nDone",
  });
  for (const w of [60, 30, 12, 7]) {
    const lines = renderChat(s.state, w, 30, tagTheme);
    check(`chat panel: ${w} wide: exactly 30 rows, none wider than ${w}`, lines.length === 30 && lines.every((x) => vw(x) <= w), lines.map((x) => vw(x)).filter((x) => x > w));
  }
  const lines = renderChat(s.state, 50, 30, tagTheme).map(plain);
  const text = lines.join("\n");
  check("chat panel: labels, no markdown markers", text.includes("you ▸") && text.includes("omp ▸") && !text.includes("**") && !text.includes("# Title") && text.includes("Title"));
  check("chat panel: list items keep their markers, wrapped lines hang", text.includes("• first item") && text.includes("1. numbered"));
  const codeRow = renderChat(s.state, 50, 30, tagTheme).find((x) => x.includes("veryLongCodeLine"));
  const codeRows = plain(renderChat(s.state, 50, 30, noTheme).join("\n"));
  check("chat panel: code is dim, indented and wraps with a ↪ instead of being clipped", codeRow !== undefined && codeRow.includes("<dim>  const") && !codeRows.includes("…") && codeRows.includes("↪") && codeRows.replace(/[\s↪]/g, "").includes("argumentNumberThree);"), codeRow);
  const view = newChatView();
  for (let i = 0; i < 12; i++) s.addChat({ role: "assistant", text: `line ${i}\nline ${i}b` });
  const follow = renderChat(s.state, 50, 10, noTheme, view);
  check("chat panel: follow shows the newest line at the bottom", plain(follow[9]!).includes("line 11b") && view.max > 0 && view.offset === 0, [follow[9], view.max]);
  view.follow = false;
  view.offset = 6;
  const up = renderChat(s.state, 50, 10, noTheme, view);
  check("chat panel: a scrolled view shows older lines", !plain(up.join("\n")).includes("line 11b") && view.offset === 6);
  s.addChat({ role: "assistant", text: "brand new\nmore\nmore" });
  const still = renderChat(s.state, 50, 10, noTheme, view);
  check("chat panel: new content does not move a scrolled view", plain(still.join("\n")) === plain(up.join("\n")) && view.offset === 10, view.offset);
  view.offset = 9999;
  renderChat(s.state, 50, 10, noTheme, view);
  check("chat panel: the offset is clamped to the top", view.offset === view.max, [view.offset, view.max]);
  const streaming = createStore();
  streaming.addChat({ role: "assistant", text: "writing", streaming: true });
  const frames = [0, 0.4].map((phase) => {
    streaming.state.phase = phase;
    return renderChat(streaming.state, 30, 3, noTheme)[0]!;
  });
  check("chat panel: a streaming message shows a blinking block cursor", frames.some((f) => f.includes("▌")) && frames[0] !== frames[1], frames);

  // --- wide lines wrap (never clipped), at every width
  const wideUrl = `https://example.com/${"a".repeat(120)}`;
  const wideTable = "| Repo | GitHub status |\n|---|---|\n| `omp-hud` | Published 0.1.0 earlier at github.com/x/omp-hud, last commit `7718ec2`; 20 commits ahead locally (`eded87f`, 0.3.0: bigger dock and typing in `/hud full`), not pushed |\n| property `api` | Never pushed. |";
  const wideCode = "```sh\ncurl -fsSL https://example.com/some/very/long/path/that/keeps/going/and/going/forever/script.sh | bash -s -- --flag\n\tindented with a tab\n```";
  const wideTr = "Çok uzun bir cümle: ğüşiöç İıŞ ÇÖÜ, hiçbir sözcük kesilmemeli; 日本語のテキストは幅が二倍です 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀 sonu.";
  const wideStore = createStore();
  wideStore.addChat({ role: "user", text: `${wideTr}\n${wideUrl}\n/home/dev/${"deep/".repeat(30)}file.txt` });
  wideStore.addChat({ role: "assistant", text: `${wideTable}\n\n${wideCode}\n\n- ${wideTr}\n- ${wideUrl}\n> ${wideTr}\n# ${wideTr}\n\x1b[31mred\x1b]0;title\x07 escape ${wideUrl}` });
  wideStore.addChat({ role: "assistant", text: "| a | b |\n|---|---|\n| 1 | 2 |" });
  wideStore.addChat({ role: "assistant", text: "| no header row | second |\n| with a very long cell that has to wrap somewhere around here | x |", streaming: true });
  const bad: Array<[number, number, number]> = [];
  for (let w = 30; w <= 220; w++) {
    const rows = renderChat(wideStore.state, w, 200, noTheme);
    const wrong = rows.filter((r) => vw(r) > w).length;
    if (rows.length !== 200 || wrong > 0) bad.push([w, rows.length, wrong]);
  }
  check("chat panel wrap: 30-220 columns, wide lines (table, URL, path, code, emoji, CJK, Turkish): 0 rows wider than the panel", bad.length === 0, bad.slice(0, 5));
  for (const w of [30, 47, 80, 133]) {
    const flat = renderChat(wideStore.state, w, 200, noTheme).map(plain).join("\n");
    const squeezed = flat.replace(/[\s↪]/g, "");
    check(`chat panel wrap ${w}: nothing is clipped (no ellipsis; URL, path, code, table cells and text survive whole)`,
      !flat.includes("…") && squeezed.includes(wideUrl) && squeezed.includes("/home/dev/") && squeezed.includes("file.txt")
        && squeezed.includes("script.sh|bash-s----flag") && squeezed.includes("indentedwithatab") && squeezed.includes("20commitsaheadlocally") && squeezed.includes("typingin`/hudfull`),notpushed")
        && squeezed.includes("😀".repeat(20)) && squeezed.includes("ğüşiöçİıŞÇÖÜ,hiçbirsözcükkesilmemeli") && squeezed.includes("日本語のテキストは幅が二倍です")
        && squeezed.includes("redescape"), flat);
  }
  const record = renderChat(wideStore.state, 50, 200, noTheme).map(plain).join("\n");
  check("chat panel wrap: a table wider than the panel becomes records (first cell, then `header: value` lines)", record.includes("▪ `omp-hud`") && record.includes("  GitHub status: Published") && record.includes("▪ property `api`") && !record.includes("| Repo |"), record);
  const wideRows = renderChat(wideStore.state, 220, 200, noTheme).map(plain).join("\n");
  check("chat panel wrap: a table that fits stays as written", wideRows.includes("| a | b |\n") && wideRows.includes("|---|---|") && wideRows.includes("| 1 | 2 |"), wideRows);
  const csiRows = renderChat(wideStore.state, 60, 200, noTheme).map((r) => r).join("\n");
  check("chat panel wrap: escape sequences in a message never reach the screen", !csiRows.includes("\x1b") && !csiRows.includes("\x07"));

  // --- scrolling stays on the same message when the width changes
  const scrollStore = createStore();
  for (let i = 0; i < 24; i++) scrollStore.addChat({ role: "assistant", text: Array.from({ length: 30 }, () => `w${i}x`).join(" ") });
  const sv = newChatView();
  renderChat(scrollStore.state, 100, 12, noTheme, sv);
  const idAt = (rows: string[], pos: number): number => {
    for (let i = pos; i >= 0; i--) {
      const m = /w(\d+)x/.exec(rows[i]!);
      if (m) return Number(m[1]);
    }
    return -1;
  };
  sv.follow = false;
  sv.offset = 60;
  const wideView = renderChat(scrollStore.state, 100, 12, noTheme, sv).map(plain);
  const wasId = idAt(wideView, 11);
  const narrowView = renderChat(scrollStore.state, 50, 12, noTheme, sv).map(plain);
  check("chat panel: a scrolled view keeps its message when the width shrinks", !sv.follow && idAt(narrowView, 11) === wasId && sv.offset > 60, [wasId, idAt(narrowView, 11), sv.offset]);
  const backView = renderChat(scrollStore.state, 100, 12, noTheme, sv).map(plain);
  check("chat panel: ... and when it grows back", idAt(backView, 11) === wasId, [wasId, idAt(backView, 11)]);
  sv.follow = true;
  const bottomRows = renderChat(scrollStore.state, 40, 12, noTheme, sv).map(plain);
  check("chat panel: a following view stays at the newest line after a width change", sv.offset === 0 && idAt(bottomRows, 11) === 23, idAt(bottomRows, 11));
  const pend = createStore();
  pend.addChat({ role: "user", text: "alpha", pending: "steer" });
  pend.addChat({ role: "user", text: "beta", pending: "after" });
  const pendRows = (): string => renderChat(pend.state, 60, 8, noTheme).map(plain).join("\n");
  check("chat panel (en): steer and after-yield tags", pendRows().includes("alpha · steering (next step)") && pendRows().includes("beta · after yield"), pendRows());
  setLang("tr");
  check("chat panel (tr): the same tags in Turkish", pendRows().includes("alpha · yönlendirme (sonraki adımda)") && pendRows().includes("beta · bitince"), pendRows());
  setLang("en");
}

console.log("[chat: full screen component]");
{
  const s = createStore();
  const sent: Array<[string, string]> = [];
  const cmds: string[] = [];
  let closed = 0;
  const hud = new FullHud(s, noTheme, () => {}, () => closed++, () => 30, { send: (t, mode) => void sent.push([t, mode]), command: (a) => void cmds.push(a) });
  const type = (str: string) => {
    for (const ch of str) hud.handleInput(ch);
  };
  const screen = (w = 140): string => hud.render(w).map(plain).join("\n");
  for (const [w, h] of [[140, 40], [120, 30], [100, 30], [80, 24], [60, 20], [50, 14]] as const) {
    const h2 = new FullHud(s, noTheme, () => {}, () => {}, () => h, undefined);
    s.addChat({ role: "assistant", text: "some answer\n".repeat(8) });
    const lines = h2.render(w);
    check(`full screen ${w}x${h}: exactly ${h} rows, none wider than ${w}`, lines.length === h && lines.every((x) => vw(x) <= w), [lines.length, lines.map((x) => vw(x)).filter((x) => x > w)]);
    check(`full screen ${w}x${h}: conversation and prompt are visible`, lines.map(plain).join("\n").includes("some answer") && plain(lines[h - 2]!).startsWith("❯"), plain(lines[h - 2]!));
    h2.dispose?.();
  }
  check("full screen: a too small terminal says so", plain(new FullHud(s, noTheme, () => {}, () => {}, () => 10).render(40).join("\n")).includes("too small"));
  check("the hint row says what Enter and Alt+Enter do", screen().includes("Enter send · Alt+Enter after yield"), screen().split("\n").at(-1));
  type("hello omp");
  hud.handleInput("\r");
  check("Enter sends plain text through the bridge as a steer", sent.length === 1 && sent[0]![0] === "hello omp" && sent[0]![1] === "steer", sent);
  type("steer me");
  hud.handleInput("\x1b\r");
  check("Alt+Enter sends it as after-yield", sent.length === 2 && sent[1]![1] === "after", sent);
  type("/hud size large");
  hud.handleInput("\r");
  check("/hud ... runs locally (arguments only)", cmds.join() === "size large" && sent.length === 2, [cmds, sent.length]);
  type("/hud");
  hud.handleInput("\r");
  check("/hud alone runs the toggle locally", cmds.at(-1) === "");
  type("/plan now");
  hud.handleInput("\r");
  check("another slash command is refused with a hint, nothing is sent, the text stays", sent.length === 2 && cmds.length === 2 && screen().includes("only /hud ... works") && screen().includes("❯ /plan now"));
  hud.handleInput("\x1b");
  check("Esc clears a non-empty prompt first", closed === 0 && screen().includes("type a message"));
  type("qc");
  check("q and c are text now, not shortcuts", closed === 0 && screen().includes("❯ qc"));
  hud.handleInput("\x15");
  s.upsertNode({ id: "n1", name: "explore", status: "running" });
  hud.handleInput("\t");
  hud.handleInput("\r");
  check("Tab selects a node, an empty Enter opens its details", screen().includes("DETAILS"));
  hud.handleInput("\x1b");
  check("Esc closes the details first", closed === 0 && !screen().includes("DETAILS"));
  for (let i = 0; i < 30; i++) s.addChat({ role: "assistant", text: `scroll line ${i}` });
  hud.render(140);
  hud.handleInput("\x1b[5~");
  check("PageUp scrolls the conversation and shows the new-content marker", screen().includes("CHAT ↓ new") && !screen().includes("scroll line 29"));
  hud.handleInput("\x1b[F");
  check("End (empty prompt) jumps back to the newest line", !screen().includes("↓ new") && screen().includes("scroll line 29"));
  hud.handleInput("\x1b[1;5A");
  check("Ctrl+Up scrolls up a little", screen().includes("↓ new"));
  hud.handleInput("\x1b[1;5F");
  check("Ctrl+End follows again", !screen().includes("↓ new"));
  hud.handleInput("\x1b[200~pasted text\x1b[201~");
  check("a paste lands in the prompt", screen().includes("❯ pasted text"));
  hud.handleInput("\x15");
  hud.handleInput("\x1b");
  check("Esc with an empty prompt and no details closes the HUD", closed === 1);
  hud.dispose?.();
}

console.log("[full screen: orbit layout]");
{
  const s = createStore();
  const t0 = Date.now();
  s.setCoreStatus("thinking");
  const kinds = ["running", "completed", "failed", "running"] as const;
  ["explore", "scout", "task", "plan"].forEach((name, i) =>
    s.upsertNode({ id: `x${i}`, name, status: kinds[i]!, startedAt: t0 - 5000, endedAt: i === 1 || i === 2 ? t0 : undefined, currentTool: i === 0 ? "grep" : undefined }),
  );
  s.addChat({ role: "assistant", text: "orbit layout answer" });
  for (let i = 0; i < 12; i++) s.tickAnimation(100);
  const shot = (w: number, h: number, keys: string[] = []): string[] => {
    const hud = new FullHud(s, noTheme, () => {}, () => {}, () => h);
    for (const k of keys) hud.handleInput(k);
    const lines = hud.render(w).map(plain);
    hud.dispose?.();
    return lines;
  };
  const rowOf = (lines: string[], text: string): number => lines.findIndex((l) => l.includes(text));
  const paneRows = (lines: string[], col: number): number => {
    // frame rows of the pane whose left edge is at `col`: from its top edge to its bottom edge
    const top = lines.findIndex((l) => [...l][col] === "╭");
    const bottom = lines.findIndex((l, i) => i > top && [...l][col] === "╰");
    return bottom - top + 1;
  };

  const wide = shot(200, 50);
  check("200x50: the orbit pane is the left half, the conversation starts at column 100", [...wide[1]!][100] === "╭" && wide[1]!.indexOf("AGENT NET") < 8 && wide[1]!.indexOf("CHAT") > 100, wide[1]);
  check("200x50: the orbit pane has the full panel height (43 rows)", paneRows(wide, 0) === 43, paneRows(wide, 0));
  check("200x50: node labels show the agent name, a status icon and the tool / duration", wide.some((l) => /explore/.test(l)) && wide.some((l) => /grep 00:05/.test(l)) && wide.some((l) => /✓ scout/.test(l)) && wide.some((l) => /✗ task/.test(l)), wide.slice(10, 20));
  check("200x50: the conversation, feed and tasks stay on the right half", rowOf(wide, "orbit layout answer") > 0 && wide.some((l) => l.includes("LIVE FEED")) && wide.some((l) => l.includes("TASKS")));
  const selected = shot(200, 50, ["\t"]);
  check("Tab highlights the node label with an arrow at the edge touching the node (none without a selection)", selected.some((l) => /[◂▸]/.test([...l].slice(0, 100).join(""))) && !wide.some((l) => /[◂▸]/.test([...l].slice(0, 100).join(""))));

  const sizes = [[200, 50], [160, 45], [140, 40], [120, 36], [100, 30], [90, 28], [80, 24], [60, 20], [50, 14]] as const;
  for (const [w, h] of sizes) {
    const lines = shot(w, h);
    check(`full screen ${w}x${h}: ${h} rows, every row exactly ${w} cells`, lines.length === h && lines.every((l) => [...l].length === w), [lines.length, lines.map((l) => [...l].length).filter((n) => n !== w)]);
  }
  const orbit120 = shot(120, 36);
  check("120x36: the orbit is the left half too", [...orbit120[1]!][60] === "╭" && paneRows(orbit120, 0) === 29, [orbit120[1], paneRows(orbit120, 0)]);
  const mid = shot(100, 30);
  const midRows = paneRows(mid, 0);
  check("100x30: the orbit sits on top (about 45% of the panel height), the conversation below it", rowOf(mid, "AGENT NET") === 1 && midRows >= 9 && midRows <= 13 && rowOf(mid, "CHAT") > midRows, [midRows, rowOf(mid, "CHAT")]);
  for (const [w, h] of [[60, 20], [80, 24]] as const) {
    const lines = shot(w, h);
    check(`${w}x${h}: a narrow terminal still shows an orbit of at least 8 rows above the conversation`, paneRows(lines, 0) >= 8 && rowOf(lines, "CHAT") > rowOf(lines, "AGENT NET"), paneRows(lines, 0));
  }
  const det = shot(140, 40, ["\t", "\t", "\r"]);
  check("details open below the orbit; the conversation stays visible", rowOf(det, "AGENT NET") === 1 && rowOf(det, "DETAILS") > rowOf(det, "AGENT NET") + 10 && det.some((l) => l.includes("orbit layout answer")), [rowOf(det, "AGENT NET"), rowOf(det, "DETAILS")]);
  const detShort = shot(140, 30, ["\t", "\r"]);
  check("on a short terminal the details replace the orbit, the conversation stays visible", rowOf(detShort, "DETAILS") === 1 && !detShort.some((l) => l.includes("AGENT NET")) && detShort.some((l) => l.includes("orbit layout answer")));

  const empty = createStore();
  const idleHud = new FullHud(empty, noTheme, () => {}, () => {}, () => 50);
  const idle = idleHud.render(200).map(plain);
  check("200x50 idle: no nodes shows the core with the status caption (no dead, crowded scene)", idle.some((l) => l.includes("main agent · ready")) && !idle.some((l) => /[✓✗]/.test(l.slice(0, 100))), idle.slice(44, 46));
  idleHud.dispose?.();
}

console.log("[chat: index.ts bridge]");
{
  const before = idx.sent.length;
  const p = cmd.handler("full", M.ctx);
  let closed = 0;
  const full = M.custom.factory!(M.tui, M.theme, {}, (r: unknown) => { closed++; M.custom.done!(r); }) as { render(w: number): readonly string[]; handleInput(d: string): void; dispose?(): void };
  const type = (str: string) => {
    for (const ch of str) full.handleInput(ch);
  };
  const screen = (): string => full.render(140).map(plain).join("\n");
  M.idle.value = true;
  type("first message");
  full.handleInput("\r");
  check("idle: sendUserMessage without deliverAs (starts a turn)", idx.sent.length === before + 1 && idx.sent[before]!.text === "first message" && idx.sent[before]!.deliverAs === undefined, idx.sent.slice(before));
  check("the sent text is in the panel at once", screen().includes("you ▸ first message"));
  await idx.emit("message_start", { message: { role: "user", content: [{ type: "text", text: "first message" }] } }, M.ctx);
  check("omp reporting it back does not duplicate it", screen().split("first message").length === 2);
  type("idle after yield");
  full.handleInput("\x1b\r");
  check("idle: Alt+Enter is a normal prompt too (no deliverAs: omp would queue it instead of starting a turn)", idx.sent.length === before + 2 && idx.sent[before + 1]!.text === "idle after yield" && idx.sent[before + 1]!.deliverAs === undefined, idx.sent.slice(before));
  check("idle: no pending tag and no badge", !screen().includes("idle after yield ·") && !screen().includes("pending"));
  await idx.emit("message_start", { message: { role: "user", content: [{ type: "text", text: "idle after yield" }] } }, M.ctx);
  await idx.emit("agent_start", {}, M.ctx);
  M.idle.value = false;
  const b0 = idx.sent.length;
  type("second message");
  full.handleInput("\r");
  type("third message");
  full.handleInput("\x1b\r");
  check("busy: Enter has no deliverAs (omp steers while streaming, like the editor's Enter), Alt+Enter is followUp", idx.sent.length === b0 + 2 && idx.sent[b0]!.text === "second message" && idx.sent[b0]!.deliverAs === undefined && idx.sent[b0 + 1]!.text === "third message" && idx.sent[b0 + 1]!.deliverAs === "followUp", idx.sent.slice(b0));
  check("pending messages carry a clear tag each", screen().includes("second message · steering (next step)") && screen().includes("third message · after yield"));
  check("the panel title counts the pending messages and their modes", screen().includes("CHAT · 2 pending (1 steering, 1 after yield)"), screen().split("\n").find((l) => l.includes("CHAT")));
  await idx.emit("message_start", { message: { role: "user", content: [{ type: "text", text: "second message" }] } }, M.ctx);
  check("when omp starts a steered message its tag disappears; the other keeps its tag and the badge shrinks", !screen().includes("second message ·") && screen().includes("third message · after yield") && screen().includes("CHAT · 1 pending (after yield)"));
  await idx.emit("agent_end", { messages: [] }, M.ctx);
  const notes = M.notes.length;
  const opened = M.custom.opened;
  type("/hud help");
  full.handleInput("\r");
  const chatText = screen().split("\n").map((l) => [...l].slice(70).join("").replace(/^│|│$/g, "").trim()).join(" ").replace(/\s+/g, " "); // right half, wrapped lines joined
  check("/hud help runs inside the HUD: output in the panel, no notification behind the overlay", chatText.includes("Only /hud ... commands run inside the HUD.") && M.notes.length === notes, [M.notes.length, notes]);
  type("/hud full");
  full.handleInput("\r");
  check("/hud full inside the HUD says so and does not open a second one", screen().includes("already in full screen") && M.custom.opened === opened);
  type("/hud lang tr");
  full.handleInput("\r");
  check("a /hud command that changes state runs for real (language)", screen().includes("Dil: tr (elle)"), screen().split("\n").slice(-6));
  check("tr: the badge is in Turkish", screen().includes("SOHBET · 1 bekliyor (bitince)"), screen().split("\n").find((l) => l.includes("SOHBET")));
  type("/hud lang en");
  full.handleInput("\r");
  check("/hud lang en restores the language", screen().includes("Language: en (manual)"));
  full.handleInput("\x1b");
  await p;
  full.dispose?.();
  check("Esc closes the overlay (command promise settles)", closed === 1 && M.activeMs().length === 0, M.activeMs());
  const before2 = idx.sent.length;
  const dp = cmd.handler("demo full", M.ctx);
  const demo = M.custom.factory!(M.tui, M.theme, {}, (r: unknown) => M.custom.done!(r)) as { render(w: number): readonly string[]; handleInput(d: string): void; dispose?(): void };
  for (const ch of "hello demo") demo.handleInput(ch);
  demo.handleInput("\r");
  check("demo: typing never reaches omp, the demo answers itself", idx.sent.length === before2 && demo.render(140).map(plain).join("\n").includes("This is a demo"));
  M.custom.done!(undefined);
  await dp;
  demo.dispose?.();
}

console.log("[chat: closing and reopening the full screen]");
{
  const before = idx.sent.length;
  const open = (): { full: { render(w: number): readonly string[]; handleInput(d: string): void; dispose?(): void }; done: Promise<void> } => {
    const done = cmd.handler("full", M.ctx) as Promise<void>;
    const full = M.custom.factory!(M.tui, M.theme, {}, (r: unknown) => M.custom.done!(r)) as { render(w: number): readonly string[]; handleInput(d: string): void; dispose?(): void };
    return { full, done };
  };
  const shown = (full: { render(w: number): readonly string[] }): string => full.render(140).map(plain).join("\n");
  const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
  const first = open();
  M.idle.value = true;
  for (const ch of "reopen probe") first.full.handleInput(ch);
  first.full.handleInput("\r");
  await idx.emit("agent_start", {}, M.ctx);
  await idx.emit("message_start", { message: { role: "user", content: "reopen probe", timestamp: 9000 } }, M.ctx);
  await idx.emit("message_start", { message: { role: "assistant", content: [], timestamp: 9001 } }, M.ctx);
  await idx.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "reopen answer" }] } }, M.ctx);
  await idx.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "reopen answer" }], timestamp: 9001 } }, M.ctx);
  await idx.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "reopen answer" }] } }, M.ctx);
  await idx.emit("agent_end", { messages: [] }, M.ctx);
  check("full screen: the question and the answer are shown once each", count(shown(first.full), "reopen probe") === 1 && count(shown(first.full), "reopen answer") === 1, shown(first.full));
  first.full.handleInput("\x1b");
  await first.done;
  first.full.dispose?.();
  const second = open();
  check("reopening the full screen shows every message once (the conversation is not copied or lost)", count(shown(second.full), "reopen probe") === 1 && count(shown(second.full), "reopen answer") === 1, shown(second.full));
  second.full.handleInput("\x1b");
  await second.done;
  second.full.dispose?.();
  check("reopening sent nothing to omp", idx.sent.length === before + 1, idx.sent.slice(before));
}

await idx.emit("session_shutdown", {}, M.ctx);
check("session_shutdown: no timers left", M.activeMs().length === 0);

console.log(`\n${failures === 0 ? "GREEN" : "RED"}: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
