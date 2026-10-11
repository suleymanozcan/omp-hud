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

  "status.ctx": "bağlam",

  "cmd.description":
    "omp-hud: /hud, /hud full, /hud size, /hud place, /hud demo, /hud compact, /hud status, /hud pad, /hud lang, /hud doctor, /hud help",
  "cmd.help":
    "omp-hud komutları:\n" +
    "  /hud              dock'u editörün yanında aç/kapat (varsayılan; yazmaya devam edebilirsiniz)\n" +
    "  /hud full         tam ekran HUD (Esc ile çıkış; açıkken yazılamaz)\n" +
    "  /hud size         dock boyutu: small 8 | medium 12 | large 16 satır (varsayılan large); şimdi {size}\n" +
    "  /hud place        dock yeri: above | below (editörün üstü | altı); şimdi {place}\n" +
    "  /hud demo         dock'ta sahte olay akışı (yeniden ya da `off` durdurur; `full` = tam ekran)\n" +
    "  /hud compact      editörün altında 1-3 satırlık küçük panel: on | off (dock'u kapatır)\n" +
    "  /hud status       alt çubuktaki tek satırlık HUD özeti: on | off (argümansız: durumu göster)\n" +
    "  /hud pad [0-3]    ekranın altında boş bırakılan satır (editör altı görünümler ve tam ekran); şimdi {pad}\n" +
    "  /hud lang         arayüz dili: tr | en | auto (yalnız bu oturum)\n" +
    "  /hud doctor       tanı: dock, kompakt panel, durum satırı, ekran boyutu, depo, zamanlayıcı\n" +
    "  /hud help         bu yardım\n" +
    "Ortam değişkeni: OMP_HUD_LANG=tr|en, OMP_HUD_SIZE=small|medium|large, OMP_HUD_PLACE=above|below, OMP_HUD_PAD=0-3 (başlangıç değerleri; dil için yedek LC_ALL/LC_MESSAGES/LANG, sonra en)\n" +
    "Ekranın altında bir şey görünmüyor mu? /hud pad 2 ve /hud status on deneyin, sonra /hud doctor.",
  "cmd.compactOn": "Kompakt HUD: açık (editörün altında 1-3 satır)",
  "cmd.compactAlreadyOn": "Kompakt HUD: zaten açık (yeniden uygulandı)",
  "cmd.compactOff": "Kompakt HUD: kapalı",
  "cmd.compactAlreadyOff": "Kompakt HUD: zaten kapalı",
  "cmd.compactFailed": "Kompakt HUD başlatılamadı: {err}",
  "cmd.statusOn": "HUD durum satırı: açık (alt çubuk durumu, anahtar hud)",
  "cmd.statusAlreadyOn": "HUD durum satırı: zaten açık",
  "cmd.statusOff": "HUD durum satırı: kapalı",
  "cmd.statusAlreadyOff": "HUD durum satırı: zaten kapalı",
  "cmd.statusUsage": "Kullanım: /hud status [on|off]",
  "cmd.statusFailed": "HUD durum satırı hatası: {err}",
  "cmd.padNow": "Alt boşluk: {n} boş satır (küçük panel ve tam ekran HUD)",
  "cmd.padUsage": "Kullanım: /hud pad [0-3]",
  "cmd.demoClosed": "Demo kapandı",
  "cmd.dockOn": "HUD dock: açık ({size}, {place})",
  "cmd.dockOnSwitched": "HUD dock: açık ({size}, {place}); kompakt panel kapatıldı",
  "cmd.dockOff": "HUD dock: kapalı (/hud yeniden açar)",
  "cmd.dockFailed": "HUD dock başlatılamadı: {err}",
  "cmd.compactOnSwitched": "Kompakt HUD: açık (editörün altında 1-3 satır); dock kapatıldı",
  "cmd.sizeNow": "Dock boyutu: {size} (bu terminal yüksekliğinde yaklaşık {rows} satır)",
  "cmd.sizeUsage": "Kullanım: /hud size small|medium|large",
  "cmd.placeNow": "Dock yeri: {place}",
  "cmd.placeUsage": "Kullanım: /hud place above|below",
  "cmd.demoOn": "Demo dock'ta çalışıyor (/hud demo yeniden ya da /hud demo off durdurur)",
  "cmd.demoOff": "Demo durdu",
  "cmd.demoNone": "Çalışan demo yok",
  "cmd.demoUsage": "Kullanım: /hud demo [off|full]",
  "place.above": "editörün üstünde",
  "place.below": "editörün altında",
  "cmd.langNow": "Dil: {lang} ({mode})",
  "cmd.langAuto": "otomatik",
  "cmd.langManual": "elle",
  "cmd.langUsage": "Kullanım: /hud lang [tr|en|auto]",
  "cmd.unknown": "Bilinmeyen alt komut: {sub}",
  "cmd.error": "HUD hatası: {err}",
  "cmd.openFailed": "HUD açılamadı: {err}",

  "doc.title": "omp-hud tanı",
  "doc.version": "sürüm: {v}",
  "doc.lang": "dil: {lang} ({mode}) · OMP_HUD_LANG={env} · COLORTERM={ct}",
  "doc.mode": "mod: {mode} · arayüz: {ui}",
  "doc.widget": "küçük panel: {state} · setWidget: {call} · bağlandı: {mounted} · çizim: {n}{last}",
  "doc.dock": "dock: {state} · boyut {size} ({rows} satır) · yer {place} · setWidget: {call} · bağlandı: {mounted} · çizim: {n}{last}",
  "doc.demo": "demo: {state}",
  "doc.demoDock": "dock'ta çalışıyor",
  "doc.demoNone": "çalışmıyor",
  "doc.status": "durum satırı: {state} · setStatus: {call} · yazım: {n} · metin: {text}",
  "doc.screen": "ekran: satır {rows} · sütun {cols} · boşluk {pad} · tam ekran satırı {full} · küçük panel satırı {lines}",
  "doc.store": "depo: v{ver} · çekirdek: {core} ({since}) · düğümler: {nodes} · son olay: {event}",
  "doc.timer": "zamanlayıcı: {timer}",
  "doc.on": "açık",
  "doc.off": "kapalı",
  "doc.yes": "evet",
  "doc.no": "hayır",
  "doc.unknown": "bilinmiyor",
  "doc.none": "yok",
  "doc.never": "çağrılmadı",
  "doc.ok": "tamam {ago}",
  "doc.failed": "hata: {err}",
  "doc.ago": "{s} sn önce",
  "doc.lastRender": " (son {w}x{n})",
  "doc.timerRunning": "çalışıyor, {ms} ms ({hz} Hz)",
  "doc.timerStopped": "durdu",

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

  "cmd.description":
    "omp-hud: /hud, /hud full, /hud size, /hud place, /hud demo, /hud compact, /hud status, /hud pad, /hud lang, /hud doctor, /hud help",
  "cmd.help":
    "omp-hud commands:\n" +
    "  /hud              show/hide the dock next to the editor (default; you can keep typing)\n" +
    "  /hud full         full-screen HUD (Esc to close; no typing while open)\n" +
    "  /hud size         dock size: small 8 | medium 12 | large 16 rows (default large); now {size}\n" +
    "  /hud place        dock place: above | below the editor; now {place}\n" +
    "  /hud demo         simulated events in the dock (again or `off` stops; `full` = full screen)\n" +
    "  /hud compact      small 1-3 line panel below the editor: on | off (closes the dock)\n" +
    "  /hud status       one-line HUD summary in the footer status: on | off (no argument: show state)\n" +
    "  /hud pad [0-3]    blank rows kept free at the bottom (below-editor views and full screen); now {pad}\n" +
    "  /hud lang         interface language: tr | en | auto (this session only)\n" +
    "  /hud doctor       diagnostics: dock, compact, status line, screen size, store, timer\n" +
    "  /hud help         this help\n" +
    "Environment: OMP_HUD_LANG=tr|en, OMP_HUD_SIZE=small|medium|large, OMP_HUD_PLACE=above|below, OMP_HUD_PAD=0-3 (initial values; language falls back to LC_ALL/LC_MESSAGES/LANG, then en)\n" +
    "Nothing visible at the bottom of the screen? Try /hud pad 2 and /hud status on, then /hud doctor.",
  "cmd.compactOn": "Compact HUD: on (1-3 lines below the editor)",
  "cmd.compactAlreadyOn": "Compact HUD: already on (re-applied)",
  "cmd.compactOff": "Compact HUD: off",
  "cmd.compactAlreadyOff": "Compact HUD: already off",
  "cmd.compactFailed": "Compact HUD failed to start: {err}",
  "cmd.statusOn": "HUD status line: on (footer status, key hud)",
  "cmd.statusAlreadyOn": "HUD status line: already on",
  "cmd.statusOff": "HUD status line: off",
  "cmd.statusAlreadyOff": "HUD status line: already off",
  "cmd.statusUsage": "Usage: /hud status [on|off]",
  "cmd.statusFailed": "HUD status line failed: {err}",
  "cmd.padNow": "Bottom padding: {n} blank row(s) (compact panel and full-screen HUD)",
  "cmd.padUsage": "Usage: /hud pad [0-3]",
  "cmd.demoClosed": "Demo closed",
  "cmd.dockOn": "HUD dock: on ({size}, {place})",
  "cmd.dockOnSwitched": "HUD dock: on ({size}, {place}); the compact panel was closed",
  "cmd.dockOff": "HUD dock: off (/hud opens it again)",
  "cmd.dockFailed": "HUD dock failed to start: {err}",
  "cmd.compactOnSwitched": "Compact HUD: on (1-3 lines below the editor); the dock was closed",
  "cmd.sizeNow": "Dock size: {size} (about {rows} rows at this terminal height)",
  "cmd.sizeUsage": "Usage: /hud size small|medium|large",
  "cmd.placeNow": "Dock place: {place}",
  "cmd.placeUsage": "Usage: /hud place above|below",
  "cmd.demoOn": "Demo running in the dock (/hud demo again or /hud demo off stops it)",
  "cmd.demoOff": "Demo stopped",
  "cmd.demoNone": "No demo is running",
  "cmd.demoUsage": "Usage: /hud demo [off|full]",
  "place.above": "above the editor",
  "place.below": "below the editor",
  "cmd.langNow": "Language: {lang} ({mode})",
  "cmd.langAuto": "auto",
  "cmd.langManual": "manual",
  "cmd.langUsage": "Usage: /hud lang [tr|en|auto]",
  "cmd.unknown": "Unknown subcommand: {sub}",
  "cmd.error": "HUD error: {err}",
  "cmd.openFailed": "HUD failed to open: {err}",

  "doc.title": "omp-hud doctor",
  "doc.version": "version: {v}",
  "doc.lang": "language: {lang} ({mode}) · OMP_HUD_LANG={env} · COLORTERM={ct}",
  "doc.mode": "mode: {mode} · ui: {ui}",
  "doc.widget": "compact widget: {state} · setWidget: {call} · mounted: {mounted} · renders: {n}{last}",
  "doc.dock": "dock: {state} · size {size} ({rows} rows) · place {place} · setWidget: {call} · mounted: {mounted} · renders: {n}{last}",
  "doc.demo": "demo: {state}",
  "doc.demoDock": "running in the dock",
  "doc.demoNone": "not running",
  "doc.status": "status line: {state} · setStatus: {call} · writes: {n} · text: {text}",
  "doc.screen": "screen: rows {rows} · columns {cols} · pad {pad} · full-screen rows {full} · compact lines {lines}",
  "doc.store": "store: v{ver} · core: {core} ({since}) · nodes: {nodes} · last event: {event}",
  "doc.timer": "timer: {timer}",
  "doc.on": "on",
  "doc.off": "off",
  "doc.yes": "yes",
  "doc.no": "no",
  "doc.unknown": "unknown",
  "doc.none": "none",
  "doc.never": "not called",
  "doc.ok": "ok {ago}",
  "doc.failed": "failed: {err}",
  "doc.ago": "{s}s ago",
  "doc.lastRender": " (last {w}x{n})",
  "doc.timerRunning": "running, {ms} ms ({hz} Hz)",
  "doc.timerStopped": "stopped",

  "status.ctx": "ctx",

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
