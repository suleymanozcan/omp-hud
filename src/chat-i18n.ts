// Strings of the full-screen conversation panel and prompt box (tr + en). Shared words live in i18n.ts; only the language is read from there.
// `en` is typed against the `tr` keys, so a missing translation is a compile error.
import { getLang } from "./i18n.ts";

const tr = {
  "chat.title": "SOHBET",
  "chat.you": "sen ▸",
  "chat.omp": "omp ▸",
  "chat.sys": "hud ▸",
  "chat.empty": "henüz mesaj yok · aşağıya yazın",
  "chat.newBelow": "↓ yeni",
  "chat.after": "bitince",
  "chat.steer": "yönlendirme (sonraki adımda)",
  "chat.pending": "{n} bekliyor ({what})",
  "chat.pendingSteer": "yönlendirme",
  "chat.pendingAfter": "bitince",
  "chat.placeholder": "mesaj yazın…",
  "chat.hint.base": "Esc kapat · Enter gönder · Alt+Enter bitince · Tab düğüm · PgUp/PgDn kaydır",
  "chat.hint.typing": "Esc temizle · Enter gönder · Alt+Enter bitince · Tab düğüm · PgUp/PgDn kaydır",
  "chat.hint.selected": "Esc kapat · boş Enter ayrıntı · Tab sonraki düğüm · Alt+Enter bitince · PgUp/PgDn kaydır",
  "chat.hint.detail": "Esc ayrıntıyı kapat · Tab düğüm · Enter ayrıntı",
  "chat.noSlash": "Bu komut HUD içinde desteklenmiyor: yalnız /hud ... çalışır. Esc ile çıkıp editörde yazın.",
  "chat.alreadyFull": "Zaten tam ekrandasınız.",
  "chat.demoReply": "Bu bir demo: mesajınız omp'ye gönderilmedi.",
  "chat.sendFailed": "Mesaj gönderilemedi: {err}",
  "chat.help":
    "Tam ekranda yazabilirsiniz. Enter gönderir, editördeki Enter gibi: ajan meşgulken mesaj bir sonraki adımda ona iletilir (omp'de 'Steering'). Alt+Enter mesajı ajan bitirince iletir (omp'de 'After yield'). " +
    "Esc: önce ayrıntıyı, sonra girdiyi temizler, sonra kapatır. Tab/Shift+Tab düğüm seçer, boş Enter ayrıntıyı açar. " +
    "PgUp/PgDn ya da Ctrl+↑/↓ sohbeti kaydırır, End (Ctrl+End) en alta döner. Girdi satırında ←/→, Home/End, Ctrl+A/E, Ctrl+U, Ctrl+W, ↑/↓ (geçmiş). " +
    "Yalnız /hud ... komutları HUD içinde çalışır.",
  "demo.chat.u1": "Kimlik doğrulama modülünü düzenle ve token yenileme için test ekle.",
  "demo.chat.a1":
    "Başlıyorum. Plan şöyle:\n\n1. `auth.ts` dosyasını oturum ve token yardımcılarına böl\n2. Sahte saatle bir yenileme testi ekle\n3. Tüm paketi çalıştır\n\n```ts\nexport function refresh(token: Token): Token {\n  return { ...token, expires: now() + TTL };\n}\n```\n\nAlt ajanlar şu an çağrı noktalarını tarıyor.",
  "demo.chat.u2": "Önce yeniden deneme yolunda başarısız bir test olduğundan emin ol.",
  "demo.chat.a2": "İyi fikir. `retry.test.ts` ekledim ve beklendiği gibi başarısız oluyor:\n\n- 3 deneme beklendi, 1 geldi\n\nGeri çekilmeyi düzeltiyorum.",
  "demo.chat.u3": "İşin bitince README'yi de güncelle.",
  "demo.chat.a3": "Sıradaki mesajınızı aldım: README yeni yeniden deneme davranışını anlatıyor.",
} as const;

const en: Record<keyof typeof tr, string> = {
  "chat.title": "CHAT",
  "chat.you": "you ▸",
  "chat.omp": "omp ▸",
  "chat.sys": "hud ▸",
  "chat.empty": "no messages yet · type below",
  "chat.newBelow": "↓ new",
  "chat.after": "after yield",
  "chat.steer": "steering (next step)",
  "chat.pending": "{n} pending ({what})",
  "chat.pendingSteer": "steering",
  "chat.pendingAfter": "after yield",
  "chat.placeholder": "type a message…",
  "chat.hint.base": "Esc close · Enter send · Alt+Enter after yield · Tab node · PgUp/PgDn scroll",
  "chat.hint.typing": "Esc clear · Enter send · Alt+Enter after yield · Tab node · PgUp/PgDn scroll",
  "chat.hint.selected": "Esc close · empty Enter details · Tab next node · Alt+Enter after yield · PgUp/PgDn scroll",
  "chat.hint.detail": "Esc close details · Tab node · Enter details",
  "chat.noSlash": "This command is not supported inside the HUD: only /hud ... works. Press Esc and type it in the editor.",
  "chat.alreadyFull": "You are already in full screen.",
  "chat.demoReply": "This is a demo: your message was not sent to omp.",
  "chat.sendFailed": "Could not send the message: {err}",
  "chat.help":
    "You can type in full screen. Enter sends, like the editor's Enter: while the agent is busy the message reaches it at its next step (omp's 'Steering'). Alt+Enter delivers it once the agent yields (omp's 'After yield'). " +
    "Esc first closes the details, then clears the input, then closes the HUD. Tab/Shift+Tab selects a node, an empty Enter opens its details. " +
    "PgUp/PgDn or Ctrl+↑/↓ scroll the chat, End (Ctrl+End) jumps back to the bottom. In the input: ←/→, Home/End, Ctrl+A/E, Ctrl+U, Ctrl+W, ↑/↓ (history). " +
    "Only /hud ... commands run inside the HUD.",
  "demo.chat.u1": "Refactor the auth module and add tests for the token refresh.",
  "demo.chat.a1":
    "On it. Here is the plan:\n\n1. Split `auth.ts` into session and token helpers\n2. Add a refresh test with a fake clock\n3. Run the whole suite\n\n```ts\nexport function refresh(token: Token): Token {\n  return { ...token, expires: now() + TTL };\n}\n```\n\nThe subagents are scanning the call sites now.",
  "demo.chat.u2": "Make sure the retry path has a failing test first.",
  "demo.chat.a2": "Good idea. I added `retry.test.ts` and it fails as expected:\n\n- expected 3 attempts, got 1\n\nFixing the backoff now.",
  "demo.chat.u3": "Also update the README when you are done.",
  "demo.chat.a3": "Got your queued message: the README now lists the new retry behaviour.",
};

export type ChatKey = keyof typeof tr;

const CATALOG = { tr, en } as const;

/** Looks up `key` in the active language; `{name}` placeholders are replaced from `params`. */
export function ct(key: ChatKey, params?: Readonly<Record<string, string | number>>): string {
  const s = CATALOG[getLang()][key];
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}
