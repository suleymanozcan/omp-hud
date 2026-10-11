# Tam ekran HUD'da slash komutları

`/hud full` girdi kutusuna yazılan `/komut`, `!kabuk` ve `$ python` satırlarının omp'ye nasıl ulaştığı, nelerin doğrulandığı ve özelliğin neye dayandığı. İngilizce: [slash-commands.md](slash-commands.md). Yalnız **omp 18.8.9** ile doğrulandı.

## Neden dolambaçlı yol gerekiyor

omp'de bir eklentinin komut çalıştırabileceği bir API yoktur: ne `ctx` ne `pi` sunar (`pi.getCommands()` yalnız eklenti, istem ve skill komutlarını listeler, yerleşikleri değil). `pi.sendUserMessage(text)` metni komut ya da şablon açmadan düz olarak gönderir; yani bu yolla giden `/plan`, modele `/plan` metni olarak gider. Yazmayla aynı biçimde her şeyi çalıştıran tek yol omp'nin kendi editörüdür; HUD onu kullanır.

## Hat (`src/slash.ts`, `index.ts` içinde `runLine`)

1. **Satırı sınıflandır.** `/hud ...` yerel kalır. Diğer `/x`, `!x` ve `$ x` satırları omp'nindir; gerisi ajana mesajdır (`Enter` / `Alt+Enter` eskisi gibi; `makeBridge.send`'e dokunulmadı).
2. **Bilinmeyen komutu reddet.** omp bilinmeyen `/xyz`'yi modele düz metin olarak gönderir. HUD adın var olup olmadığını omp'nin tamamlama sağlayıcısına sorar (takma adlar dahil), yoksa reddeder. Sağlayıcı yakalanamamışsa denetim atlanır (satır iletilir).
3. **Taslağı kaydet** (`ctx.ui.getEditorText()`).
4. **Katmanı gizle:** `ctx.ui.custom(..., { onHandle })` ile gelen tutamak: `handle.setHidden(true)` odağı omp'nin editörüne verir. Bu her komut için gereklidir: bir eklentinin açtığı diyalog (`ctx.ui.select`, `/settings`) görünür tam ekran katmanın altında odaksız ve görünmez monte edilir.
5. **Editörü bul.** `submit`, `setText` ve `getText` işlevleri olan odaklı bileşen; yoksa `tui.children` gezintisi (derinlik 8, döngüye karşı korumalı). `disableSubmit` olan editör kullanılmaz.
6. **Gönder.** `ctx.ui.setEditorText(satır)`, sonra `editor.submit()`: Enter tuşuyla aynı yol (`source: "interactive"` ile `input` olayı dahil).
7. **Odağı bekle** (50 ms'de bir yokla: `tui.getFocused() === editor && !tui.hasOverlay()`). Bir görüntüleyici ya da diyalog odağı aldıysa, odak dönünce HUD kendiliğinden geri gelir. 200 ms içinde odak hiç ayrılmadıysa komut yalnız konuşma dökümüne ya da durum satırına yazmıştır: HUD gizli kalır, durum satırı `HUD: devam için herhangi bir tuş` der ve ilk tuş (odak ya da fare raporları değil) `ctx.ui.onTerminalInput` ile yutulur ve HUD'u açar. Geç açılan bir diyalog bu duraklamayı iptal eder ve her zamanki gibi beklenir. Tuş dinleyicisi kurulamazsa HUD hemen döner.
8. **Her yolda geri dön.** `finally` taslağı geri koyar (komut editörü kendisi doldurmadıysa) ve `setHidden(false)` çağırır: editör bulunamadı, gönderim kapalı, istisna, oturumu değiştiren komut (`/new`) dahil her yolda. Tek istisna bu arada kapatılmış HUD'dur (`/exit`).

Çalışan bir komut varken ikincisi reddedilir (`Önceki komut hâlâ çalışıyor`). `/hud demo full` içinde hiçbir şey gönderilmez.

## Palet

Girdinin başındaki `/` ve imleçteki `@` anmasında HUD **yakalanan taban tamamlama sağlayıcısına** (`ctx.ui.addAutocompleteProvider`, süreç başına bir kez kaydedilen, yalnız omp'nin verdiği tabanı hatırlayan geçiş sağlayıcısı) `getSuggestions([satır], 0, imleç)` ile sorar ve en çok 8 öğe gösterir: ad (komutlarda `/` ile), argüman ipucu, açıklama. `↑` / `↓` seçer, `Tab` sağlayıcının `applyCompletion`'ı ile uygular, `Enter` metin değişmeyecekse çalıştırır (değişecekse uygular), `Esc` kapatır. Tuş başına bir sorgu; eski metne verilen geç cevap atılır. omp'nin öğeleri çizilmeden önce kontrol karakterlerinden ve ANSI'den temizlenir.

## Nelerin doğrulandığı (omp 18.8.9, yerel sahte sağlayıcı, model isteği yok)

pty ile terminal denemeleri (`Bun.spawn({ terminal })` + `@xterm/headless`), `omp --no-session --no-skills --no-rules --no-lsp --no-extensions -e <index.ts> -e <sahte sağlayıcı>`; sahte sağlayıcı her model çağrısını sayar.

- `/to` `tools`u canlı açıklamasıyla başa koyar; `/session ` `info`, `delete`, `pin` önerir; `@co` dosyaları listeler; `Esc` listeyi kapatıp metni korur; dar 80x24 ekran çalışır.
- `/tools` (görüntüleyici), `/dlg` (eklentinin `select`'i): HUD gizlenir, diyalog görünür ve odaklıdır, `Esc` kapatır ve HUD kendiliğinden döner.
- `/ping x` (eklenti komutu, `notify`), `!echo hi` (çıktı `hi`), `/new`: HUD `HUD: devam için herhangi bir tuş` ile gizli kalır; tuş yutulur ve HUD döner; sonradan yazılan komutlar çalışır.
- Ajan meşgulken (9 sn'lik sahte tur) `/ping` ve `/tools` hemen çalıştı ve HUD geri geldi.
- `/xyz` reddedilir ve girdide kalır; `!echo hi` ve yukarıdaki tüm komutlar **sıfır** model çağrısı yaptı. Koşunun tek model çağrısı karşılaştırma için gönderilen düz mesajdı.
- omp editöründeki taslak hepsinden sağ çıktı; `/hud doctor` `editör evet`, `tamamlama sağlayıcısı evet` ve son komutu bildirir.

Denenmedi (gerçek modelle ya da ağla konuşurlardı): `/compact`, `/handoff`, `/btw`, `/retry`, istem şablonları, skill'ler, `/usage`. Model isteği başlattıkları omp'nin kodunu ve belgelerini okumaktan çıkarıldı, bir koşudan değil.

## Dayandığı belgesiz yüzeyler

| Yüzey | Ne için | Yoksa |
| --- | --- | --- |
| `OverlayHandle.setHidden` (tutamak belgeli, anahtarları değil) | HUD'u gizle, odağı editöre ver | komut çalışmaz, HUD söyler |
| `tui.getFocused()`, `tui.children` | omp'nin editörünü bul | komut çalışmaz, HUD söyler |
| `tui.hasOverlay()` | görüntüleyici ya da diyalog açık mı | yalnız odak karar verir |
| editör `submit()` / `disableSubmit` / `setText` | satırı gönder | komut çalışmaz, HUD söyler |
| `ctx.ui.addAutocompleteProvider` (belgeli) | palet ve ad denetimi | palet yok; adlar denetlenmez |
| `ctx.ui.onTerminalInput` (belgeli) | "herhangi bir tuş"u yut | HUD hemen döner |

omp güncellemesi bunları bozabilir. omp'yi güncelledikten sonra `/hud doctor` çalıştırın (`slash: editör evet (...)`) ve tam ekranda `/tools` deneyin.

## Sınırlar

- Komut çıktısı omp'nin ekranındadır, HUD'un sohbet panelinde değil; panele yalnız `omp'de çalıştırıldı: <satır>` notu düşer.
- Komut bir tuş beklerken HUD gizlidir; o sırada basılan `Esc` de yutulur (çalışan turu kesmez).
- omp'nin editöründe bekleyen görseller gönderilen satırla gider (omp'nin kendi davranışı); HUD ek ekleyemez.
- omp'nin Agent Hub'ında bir alt ajan odaktayken omp editör metnini o alt ajana yollar ve `/` komutlarını reddeder; eklenti bu durumu göremez (bilinmiyor).
- Geçerli bazı girdiler model isteği başlatır (README'ye bakın). Bu omp'nin davranışıdır, HUD'un değil.

## Neden `/hud reload` yok

`ExtensionCommandContext`te `ctx.reload()`, omp'de `/reload-plugins` var; yani bir güncellemeden sonra omp'yi yeniden başlatmadan HUD'u yenilemek mümkün görünüyordu. Değil (omp 18.8.9): `-e` ile yüklenen bir deneme eklentisinin ileti sabiti diskte değiştirilip `ctx.reload()` (kalıcı oturumla ve oturumsuz) ve `/reload-plugins` çalıştırıldığında eski iletiyi yazmaya devam etti, modülü ve fabrikası yeniden değerlendirilmedi (modül düzeyindeki günlük satırı bir kez çalıştı). omp'nin kodunda `ctx.reload()` oturum dosyasını yeniden okur (`session.reload()` -> aynı dosyanın `switchSession`'ı; oturum dosyası yoksa işlemsiz) ve `/reload-plugins` skill'leri, slash komutlarını ve MCP sunucularını tazeler; ikisi de eklenti modüllerini yeniden içe aktarmaz (omp'nin eklenti belgesi canlı ayar değişiklikleri için aynısını söyler: modüller kaldırılmaz ve yeniden değerlendirilmez). HUD'u güncelledikten sonra omp'yi yeniden başlatın.
