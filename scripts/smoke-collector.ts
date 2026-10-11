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
  const pi = {
    on(event: string, fn: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    registerCommand(name: string, cmd: Cmd) {
      commands.set(name, cmd);
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
  const tui = { renders: 0, requestRender() { this.renders++; }, terminal: { rows: 24, columns: 100 } };
  const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
  const custom: { factory?: (...a: unknown[]) => { render(w: number): readonly string[]; dispose?(): void }; done?: (r: unknown) => void; options?: { overlay?: boolean; overlayOptions?: { fullscreen?: boolean } }; opened: number } = { opened: 0 };
  const ctx = {
    hasUI: opts.hasUI ?? true,
    mode: opts.mode ?? "tui",
    cwd: "/tmp",
    agent: opts.agent ?? { kind: "main", id: "main", name: "main", depth: 0 },
    sessionManager: { getBranch: (): unknown[] => opts.branch ?? [] },
    getContextUsage: (): { tokens: number; contextWindow: number; percent: number } | undefined => (opts.ctxPercent === undefined ? undefined : { tokens: 10, contextWindow: 100, percent: opts.ctxPercent }),
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
    tui,
    theme,
    custom,
    widgets,
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
const w0 = M.widgets.at(-1);
check("compact widget is ON by default (belowEditor)", w0?.key === "hud" && typeof w0.content === "function" && w0.options?.placement === "belowEditor", w0);
if (typeof w0?.content !== "function") throw new Error("no compact widget factory");
// The only known factory signature: (tui, theme) => Component; called with fake objects.
const widgetFactory = w0.content as (t: unknown, th: unknown) => { render(w: number): readonly string[] };
const compact = widgetFactory(M.tui, M.theme);
const rows0 = compact.render(100);
check("compact render: rows <= width", rows0.length > 0 && rows0.every((l) => /^[^\x1b]*$/.test(l.replace(/\x1b\[[0-9;]*m/g, "")) && [...l.replace(/\x1b\[[0-9;]*m/g, "")].length <= 100), rows0.length);
check("idle: 500 ms timer", M.activeMs().join() === "500", M.activeMs());

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

await cmd.handler("compact off", M.ctx);
check("/hud compact off: widget removed, no timers", M.widgets.at(-1)?.content === undefined && M.activeMs().length === 0, M.activeMs());
await cmd.handler("compact", M.ctx);
check("/hud compact: toggle turns it on", typeof M.widgets.at(-1)?.content === "function" && M.activeMs().length === 1);
await cmd.handler("compact off", M.ctx);

// full screen (real store)
{
  const p = cmd.handler("", M.ctx);
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

// demo
{
  const rowsBeforeDemo = compact.render(100).join("\n");
  const p = cmd.handler("demo", M.ctx);
  check("/hud demo opens the full screen", M.custom.opened === 2, M.custom.opened);
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

await idx.emit("session_shutdown", {}, M.ctx);
check("session_shutdown: no timers left", M.activeMs().length === 0);

console.log(`\n${failures === 0 ? "GREEN" : "RED"}: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
