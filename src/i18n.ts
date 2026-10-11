// Interface strings in two languages (tr, en). The catalog is type-checked: the English table must have
// exactly the keys of the Turkish one. All strings are single-cell wide (Turkish letters and ASCII).
//
// Language selection: OMP_HUD_LANG (tr|en), else the first set of LC_ALL / LC_MESSAGES / LANG
// (starts with "tr" -> tr), else English. `setLang` overrides at runtime (not persisted).

export type Lang = "tr" | "en";

/** Agent id used in the feed and node tree for the main agent; the shown label comes from the catalog. */
export const MAIN_AGENT = "main";

const tr = {
  "agent.main": "ana",

  "status.idle": "hazır",
  "status.thinking": "düşünüyor",
  "status.streaming": "yazıyor",
  "status.tool": "araç",
  "status.toolNamed": "araç: {name}",
  "status.error": "hata",
  "status.done": "bitti",

  "node.running": "çalışıyor",
  "node.completed": "bitti",
  "node.failed": "hata",
  "node.aborted": "iptal",

  "warn.retry": "yeniden deneniyor",
  "warn.compaction": "bağlam sıkıştırılıyor",
  "warn.fallback": "yedek model",
  "warnShort.retry": "yeniden deneme",
  "warnShort.compaction": "sıkıştırma",
  "warnShort.fallback": "yedek model",

  "turn": "tur {n}",
  "scene.mainAgent": "ana ajan",

  "feed.title": "CANLI AKIŞ",
  "feed.empty": "henüz olay yok",
  "tasks.title": "GÖREVLER",
  "tasks.empty": "görev yok",
  "tasks.more": "+{n} görev",
  "net.title": "AJAN AĞI",

  "tok.in": "giriş",
  "tok.out": "çıkış",
  "tok.cache": "önbellek",
  "tok.ctx": "bağlam",
  "tok.title": "TOKEN",

  "detail.title": "AYRINTI",
  "detail.name": "ad",
  "detail.status": "durum",
  "detail.model": "model",
  "detail.duration": "süre",
  "detail.tokens": "token",
  "detail.cost": "maliyet",
  "detail.ctxTokens": "bağlam token",
  "detail.toolCount": "araç sayısı",
  "detail.currentTool": "güncel araç",
  "detail.error": "hata",

  "hint.detail": "Esc ayrıntıyı kapat · ←/→ düğüm",
  "hint.selected": "Esc kapat · ←/→ düğüm · Enter ayrıntı · c temizle",
  "hint.base": "Esc kapat · ←/→ düğüm · Enter ayrıntı",
  "tooSmall": "terminal çok küçük (en az {w}x{h})",

  "sub.running": "başladı",
  "sub.completed": "tamamlandı",
  "sub.failed": "başarısız",
  "sub.aborted": "iptal edildi",

  "feed.toolDone": "{name}: bitti",
  "feed.toolError": "{name}: hata",
  "feed.todoProgress": "görevler: {done}/{total} tamam",
  "feed.retrying": "yeniden deneniyor",
  "feed.retryFailed": "yeniden deneme başarısız",
  "feed.fallback": "yedek model: {from} -> {to}",
  "feed.compacting": "bağlam sıkıştırılıyor",
  "feed.compacted": "bağlam sıkıştırıldı",
  "feed.compactFailed": "sıkıştırma başarısız",

  "cmd.description": "omp-hud: /hud, /hud demo, /hud compact [on|off], /hud lang [tr|en|auto], /hud help",
  "cmd.help":
    "omp-hud komutları:\n" +
    "  /hud              tam ekran HUD (Esc ile çıkış)\n" +
    "  /hud demo         sahte olay akışıyla tam ekran gösterim\n" +
    "  /hud compact      küçük kalıcı paneli aç/kapat (on|off verilebilir)\n" +
    "  /hud lang         arayüz dili: tr | en | auto (yalnız bu oturum)\n" +
    "  /hud help         bu yardım\n" +
    "Ortam değişkeni: OMP_HUD_LANG=tr|en (başlangıç dili; yoksa LC_ALL/LC_MESSAGES/LANG, yedek en)",
  "cmd.panelOn": "HUD paneli açık",
  "cmd.panelOff": "HUD paneli kapalı",
  "cmd.langNow": "Dil: {lang} ({mode})",
  "cmd.langAuto": "otomatik",
  "cmd.langManual": "elle",
  "cmd.langUsage": "Kullanım: /hud lang [tr|en|auto]",
  "cmd.unknown": "Bilinmeyen alt komut: {sub}",
  "cmd.error": "HUD hatası: {err}",
  "cmd.openFailed": "HUD açılamadı: {err}",

  "demo.phase.discover": "Keşif",
  "demo.phase.build": "Uygulama",
  "demo.phase.verify": "Doğrulama",
  "demo.task.1": "Mimariyi incele",
  "demo.task.2": "Mevcut testleri tara",
  "demo.task.3": "Bağımlılıkları listele",
  "demo.task.4": "Depo katmanını yaz",
  "demo.task.5": "Olay toplayıcıyı bağla",
  "demo.task.6": "Arayüz bileşenini ekle",
  "demo.task.7": "Birim testleri koş",
  "demo.task.8": "İncelemeyi tamamla",
  "demo.task.9": "Notları yaz",
  "demo.taskState.in_progress": "başladı",
  "demo.taskState.completed": "bitti",
  "demo.taskState.blocked": "engellendi",
  "demo.taskState.abandoned": "bırakıldı",
  "demo.taskState.pending": "bekliyor",
  "demo.lapStart": "Demo senaryosu başladı (tur {n})",
  "demo.planReady": "Plan hazır, alt ajanlar başlatılıyor",
  "demo.subStarted": "başlatıldı: {desc}",
  "demo.subDone": "tamamlandı ({tools} araç, {tokens} token)",
  "demo.subFailed": "hata: {err}",
  "demo.unknownError": "bilinmeyen",
  "demo.intentDone": "Tamamlandı",
  "demo.intentRetry": "Yeniden deneniyor",
  "demo.retryFeed": "istek reddedildi, yeniden deneniyor (1/2)",
  "demo.timeout": "zaman aşımı (429)",
  "demo.blocker": "reviewer zaman aşımına uğradı",
  "demo.rereview": "Değişiklikleri yeniden incele",
  "demo.crowd": "kalabalık: {n} alt ajan",
  "demo.chunk": "dosya parçası {n}",
  "demo.merging": "Sonuçlar birleştiriliyor",
  "demo.finished": "Tamamlandı: {n} alt ajan, 1 hata giderildi",
  "demo.explore.desc": "Depo yapısını keşfet",
  "demo.explore.i1": "Dizin yapısını tara",
  "demo.explore.i2": "Giriş noktalarını oku",
  "demo.explore.i3": "Kullanım yerlerini ara",
  "demo.scout.desc": "Bağımlılıkları ve sürümleri tara",
  "demo.scout.i1": "Bağımlılıkları listele",
  "demo.scout.i2": "Sürüm kısıtlarını oku",
  "demo.task.desc": "Depo katmanını uygula",
  "demo.task.i1": "Mağaza arayüzünü yaz",
  "demo.task.i2": "Düzenlemeyi uygula",
  "demo.task.i3": "Derlemeyi kontrol et",
  "demo.reviewer.desc": "Değişiklikleri incele",
  "demo.reviewer.i1": "Farkı oku",
  "demo.reviewer.i2": "Tür hatalarını ara",
  "demo.test.desc": "Testleri çalıştır",
  "demo.test.i1": "Birim testleri koş",
  "demo.test.i2": "Hata çıktısını oku",
  "demo.plan.desc": "Arayüz tasarımını doğrula",
  "demo.plan.i1": "Bileşen sınırlarını çiz",
  "demo.plan.i2": "Düzeni gözden geçir",
} as const;

export type MsgKey = keyof typeof tr;

const en: Record<MsgKey, string> = {
  "agent.main": "main",

  "status.idle": "ready",
  "status.thinking": "thinking",
  "status.streaming": "streaming",
  "status.tool": "tool",
  "status.toolNamed": "tool: {name}",
  "status.error": "error",
  "status.done": "done",

  "node.running": "running",
  "node.completed": "done",
  "node.failed": "failed",
  "node.aborted": "aborted",

  "warn.retry": "retrying",
  "warn.compaction": "compacting context",
  "warn.fallback": "fallback model",
  "warnShort.retry": "retry",
  "warnShort.compaction": "compacting",
  "warnShort.fallback": "fallback",

  "turn": "turn {n}",
  "scene.mainAgent": "main agent",

  "feed.title": "LIVE FEED",
  "feed.empty": "no events yet",
  "tasks.title": "TASKS",
  "tasks.empty": "no tasks",
  "tasks.more": "+{n} more",
  "net.title": "AGENT NET",

  "tok.in": "in",
  "tok.out": "out",
  "tok.cache": "cache",
  "tok.ctx": "context",
  "tok.title": "TOKENS",

  "detail.title": "DETAILS",
  "detail.name": "name",
  "detail.status": "status",
  "detail.model": "model",
  "detail.duration": "duration",
  "detail.tokens": "tokens",
  "detail.cost": "cost",
  "detail.ctxTokens": "context tokens",
  "detail.toolCount": "tool calls",
  "detail.currentTool": "current tool",
  "detail.error": "error",

  "hint.detail": "Esc close details · ←/→ node",
  "hint.selected": "Esc close · ←/→ node · Enter details · c clear",
  "hint.base": "Esc close · ←/→ node · Enter details",
  "tooSmall": "terminal too small (min {w}x{h})",

  "sub.running": "started",
  "sub.completed": "completed",
  "sub.failed": "failed",
  "sub.aborted": "aborted",

  "feed.toolDone": "{name}: done",
  "feed.toolError": "{name}: error",
  "feed.todoProgress": "tasks: {done}/{total} done",
  "feed.retrying": "retrying",
  "feed.retryFailed": "retry failed",
  "feed.fallback": "fallback model: {from} -> {to}",
  "feed.compacting": "compacting context",
  "feed.compacted": "context compacted",
  "feed.compactFailed": "compaction failed",

  "cmd.description": "omp-hud: /hud, /hud demo, /hud compact [on|off], /hud lang [tr|en|auto], /hud help",
  "cmd.help":
    "omp-hud commands:\n" +
    "  /hud              full-screen HUD (Esc to close)\n" +
    "  /hud demo         full-screen showcase with simulated events\n" +
    "  /hud compact      toggle the small persistent panel (on|off accepted)\n" +
    "  /hud lang         interface language: tr | en | auto (this session only)\n" +
    "  /hud help         this help\n" +
    "Environment: OMP_HUD_LANG=tr|en (initial language; else LC_ALL/LC_MESSAGES/LANG, fallback en)",
  "cmd.panelOn": "HUD panel on",
  "cmd.panelOff": "HUD panel off",
  "cmd.langNow": "Language: {lang} ({mode})",
  "cmd.langAuto": "auto",
  "cmd.langManual": "manual",
  "cmd.langUsage": "Usage: /hud lang [tr|en|auto]",
  "cmd.unknown": "Unknown subcommand: {sub}",
  "cmd.error": "HUD error: {err}",
  "cmd.openFailed": "HUD failed to open: {err}",

  "demo.phase.discover": "Discovery",
  "demo.phase.build": "Implementation",
  "demo.phase.verify": "Verification",
  "demo.task.1": "Review the architecture",
  "demo.task.2": "Scan existing tests",
  "demo.task.3": "List dependencies",
  "demo.task.4": "Write the store layer",
  "demo.task.5": "Wire the event collector",
  "demo.task.6": "Add the UI component",
  "demo.task.7": "Run unit tests",
  "demo.task.8": "Finish the review",
  "demo.task.9": "Write notes",
  "demo.taskState.in_progress": "started",
  "demo.taskState.completed": "done",
  "demo.taskState.blocked": "blocked",
  "demo.taskState.abandoned": "dropped",
  "demo.taskState.pending": "pending",
  "demo.lapStart": "Demo scenario started (lap {n})",
  "demo.planReady": "Plan ready, starting subagents",
  "demo.subStarted": "started: {desc}",
  "demo.subDone": "done ({tools} tools, {tokens} tokens)",
  "demo.subFailed": "error: {err}",
  "demo.unknownError": "unknown",
  "demo.intentDone": "Done",
  "demo.intentRetry": "Retrying",
  "demo.retryFeed": "request rejected, retrying (1/2)",
  "demo.timeout": "timed out (429)",
  "demo.blocker": "reviewer timed out",
  "demo.rereview": "Re-review the changes",
  "demo.crowd": "crowd: {n} subagents",
  "demo.chunk": "file chunk {n}",
  "demo.merging": "Merging results",
  "demo.finished": "Done: {n} subagents, 1 error resolved",
  "demo.explore.desc": "Explore the repo layout",
  "demo.explore.i1": "Scan directory layout",
  "demo.explore.i2": "Read entry points",
  "demo.explore.i3": "Search usages",
  "demo.scout.desc": "Scan dependencies and versions",
  "demo.scout.i1": "List dependencies",
  "demo.scout.i2": "Read version constraints",
  "demo.task.desc": "Implement the store layer",
  "demo.task.i1": "Write the store interface",
  "demo.task.i2": "Apply the edit",
  "demo.task.i3": "Check the build",
  "demo.reviewer.desc": "Review the changes",
  "demo.reviewer.i1": "Read the diff",
  "demo.reviewer.i2": "Look for type errors",
  "demo.test.desc": "Run the tests",
  "demo.test.i1": "Run unit tests",
  "demo.test.i2": "Read failure output",
  "demo.plan.desc": "Validate the UI design",
  "demo.plan.i1": "Draw component boundaries",
  "demo.plan.i2": "Review the layout",
};

const CATALOG: Record<Lang, Record<MsgKey, string>> = { tr, en };

/** OMP_HUD_LANG, else the first non-empty of LC_ALL / LC_MESSAGES / LANG (tr* -> tr), else en. */
export function detectLang(): Lang {
  const forced = process.env.OMP_HUD_LANG?.trim().toLowerCase();
  if (forced === "tr" || forced === "en") return forced;
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  return /^tr(?:[_.@-]|$)/i.test(locale.trim()) ? "tr" : "en";
}

let current: Lang = detectLang();
let auto = true;

export function getLang(): Lang {
  return current;
}

/** True while the language follows the environment (no runtime override). */
export function isLangAuto(): boolean {
  return auto;
}

/** Runtime override (not persisted); "auto" returns to environment detection. */
export function setLang(lang: Lang | "auto"): void {
  if (lang === "auto") {
    current = detectLang();
    auto = true;
  } else {
    current = lang;
    auto = false;
  }
}

/** Looks up `key` in the active language; `{name}` placeholders are replaced from `params`. */
export function t(key: MsgKey, params?: Readonly<Record<string, string | number>>): string {
  const s = CATALOG[current][key];
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Display label of an agent id: the main agent is localized, subagent names are shown as-is. */
export function agentLabel(agent: string): string {
  return agent === MAIN_AGENT ? t("agent.main") : agent;
}
