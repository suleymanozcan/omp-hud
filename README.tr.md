# omp-hud

[English](README.md) | Türkçe

[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) için terminal HUD'u: animasyonlu ajan çekirdeği, alt ajan düğümleri, canlı akış, görevler ve token göstergeleri. Bilimkurgu kokpit ekranlarından esinlenilmiştir. Resmi olmayan bir topluluk eklentisidir; fork gerekmez, mevcut `omp`'ye eklenti olarak girer.

![Tam ekran HUD: ajan çekirdeği ve alt ajan düğümleri, canlı akış, görevler ve token göstergeleri](docs/img/hud-fullscreen.tr.png)

*Görüntü, HTML önizlemesinden (`scripts/preview.ts`) üretildi; braille karakterler gerçek terminalde daha yoğun görünür.*

## Özellikler

- Ortada **animasyonlu ajan çekirdeği**: ana ajan ve anlık durumu (boşta, düşünüyor, yazıyor, araç çalıştırıyor).
- Çekirdeğin çevresinde dönen **alt ajan düğümleri**: çalışan düğüm nabız gibi atar, biten yeşile, hata alan kırmızıya döner.
- Araç çağrıları, alt ajan başlangıç/bitişleri, yeniden denemeler ve bağlam sıkıştırmasından oluşan **canlı akış**.
- İlerlemesiyle birlikte **görevler** (todo listesi).
- **Token göstergeleri**: giriş / çıkış / önbellek tokenları, bağlam penceresi doluluğu (%), saniyedeki token (tok/s) ve maliyet.
- Editörün altında **kompakt widget** (3 satır); oturum açılınca kendiliğinden gelir.
- `/hud` ile **tam ekran** kip (alternatif ekran); çıkınca normal ekran bozulmadan geri gelir.
- **`/hud demo`**: sahte olay akışı (yaklaşık 45 sn'lik döngü); tek token harcamadan her şeyi görürsünüz.
- **İngilizce ve Türkçe** arayüz (`en` / `tr`, otomatik algılanır, çalışırken değiştirilebilir).

![Editörün altındaki kompakt widget](docs/img/hud-compact.tr.png)

## Kurulum

Eklenti desteği olan `omp` (oh-my-pi) gerekir. Yalnızca **omp 18.8.9** üzerinde geliştirildi ve denendi ([Uyumluluk](#uyumluluk-ve-dürüst-sınırlar) bölümüne bakın). Derleme adımı ve bağımlılık yoktur: omp TypeScript'i doğrudan çalıştırır.

### GitHub'dan (ana yöntem)

```sh
omp plugin install github:suleymanozcan/omp-hud
```

`omp install github:suleymanozcan/omp-hud` aynı işi görür; `git+https://github.com/suleymanozcan/omp-hud.git` da geçerli bir belirteçtir (omp'nin git belirteç biçimi: `github:kullanıcı/depo[#ref]`, `git+https://...`, `git@github.com:kullanıcı/depo`). Ardından `omp`'yi yeniden başlatın: eklentiler yalnızca başlangıçta yüklenir. Güncellemek için `omp plugin upgrade omp-hud`, kaldırmak için `omp plugin uninstall omp-hud`.

> omp 18.8.9 ile yalıtılmış bir profilde doğrulandı: `omp plugin install github:suleymanozcan/omp-hud` `omp-hud@0.1.0` sürümünü kurar; `omp plugin list` ve `omp plugin doctor` sağlıklı olduğunu bildirir; yeniden başlatmadan sonra `/hud help` ve `/hud lang en` çalışır. `omp install github:suleymanozcan/omp-hud`, `git+https://github.com/suleymanozcan/omp-hud.git` ve `omp plugin upgrade omp-hud` aynı biçimde çalıştırıldı ve başarılı oldu (`git@github.com:` biçimi denenmedi).

### Yerel kopyadan (denendi)

```sh
git clone https://github.com/suleymanozcan/omp-hud.git
omp plugin link ./omp-hud
```

`omp plugin link`, kopyayı omp'nin eklenti dizinine sembolik bağlantı olarak ekler (`omp install ./omp-hud` aynı işi yapar). Güncellemek için kopyada `git pull` yeterlidir. Ardından `omp`'yi yeniden başlatın.

### Eklentiler dizinine sembolik bağlantı (denendi)

```sh
mkdir -p ~/.omp/agent/extensions
ln -s "$PWD/omp-hud" ~/.omp/agent/extensions/hud
```

omp `~/.omp/agent/extensions/<ad>/` altını tarar ve `package.json#omp.extensions` alanını okur.

> `~/.omp/agent/extensions/hud/index.ts` içine `export { default } from "/yol/omp-hud/index.ts"` yazan bir yönlendirme dosyası **çalışmaz**: omp `@oh-my-pi/pi-tui` paketini yönlendirme dosyasından çözemez. Klasörün tamamına sembolik bağlantı kullanın.

### Kurmadan denemek (denendi)

```sh
omp -e ./omp-hud
```

### Yapılandırma dosyası (denendi)

`~/.omp/agent/config.yml` içinde (kopyanızın tam yolunu yazın):

```yaml
extensions:
  - /kopyanin/tam/yolu/omp-hud
```

## Kullanım

| Komut | Etki |
| --- | --- |
| `/hud` | Tam ekran HUD'u açar. |
| `/hud demo` | Sahte olay akışıyla tam ekran HUD (gerçek oturum durumuna dokunmaz). |
| `/hud compact on\|off` | Editörün altındaki kompakt widget'ı açar/kapatır (argümansız: tersine çevirir). |
| `/hud lang tr\|en\|auto` | Arayüz dilini bu çalışma için değiştirir (kalıcı değildir); argümansız mevcut dili gösterir. |
| `/hud help` | Komut özetini gösterir. |

Tam ekrandaki tuşlar:

| Tuş | Etki |
| --- | --- |
| `Esc` | Ayrıntı açıksa onu kapatır; değilse HUD'dan çıkar. |
| `q` | HUD'dan çıkar. |
| `←` / `→` / `Tab` | Önceki / sonraki düğümü seçer (`Shift+Tab` de geri gider). |
| `Enter` | Seçili düğümün ayrıntısını açar/kapatır. |
| `c` | Seçimi temizler. |

### Dil

Arayüz `OMP_HUD_LANG=en|tr` değerini izler; tanımsızsa `LC_ALL`, `LC_MESSAGES`, `LANG` değişkenlerinden ilk tanımlı olan belirler (`tr…` Türkçe verir), yoksa İngilizce.

```sh
OMP_HUD_LANG=tr omp
```

## omp'siz önizleme

Yalnızca [Bun](https://bun.sh) gerekir. Hiçbiri omp'yi başlatmaz ya da model çağırmaz; demo sanal zamanla ilerler.

```sh
# terminalde canlı izle (alternatif ekran, ~15 fps; Esc / q / Ctrl-C çıkar)
bun scripts/preview.ts --live

# kareleri 24-bit ANSI metni olarak bas
bun scripts/preview.ts --frames 3 --width 140 --height 40 --at 3,14,24

# HTML sayfası yaz (kompakt widget için --compact ekleyin)
bun scripts/preview.ts --frames 2 --width 140 --height 40 --at 14,24 --compact --html /tmp/hud.html
```

`bun scripts/preview.ts --help` tüm seçenekleri listeler. Komutlar her klasörden çalışır.

## Uyumluluk ve dürüst sınırlar

- **Yalnızca omp 18.8.9'da denendi** (macOS; Ghostty ve cmux). Diğer omp sürümleri ve diğer terminaller: bilinmiyor.
- **Belgelenmemiş iç kanallara dayanır.** Alt ajan verisi `pi.events` üzerindeki `task:subagent:lifecycle` ve `task:subagent:progress` olaylarından, tam ekran ise overlay `fullscreen` seçeneğinden gelir. İkisi de belgeli sözleşme değildir; omp güncellenince bozulabilir. Yedek yollar vardır: alt ajan olayları değişirse alt ajan düğümleri boş kalabilir, çekirdek, akış, görevler ve token göstergeleri çalışmaya devam eder; `fullscreen` kalkarsa HUD normal bir overlay'e düşer.
- **omp'nin ana görünümünü değiştirmez.** omp'de `setHeader` / `setFooter` etkisizdir; HUD yalnızca editörün altındaki widget ve tam ekran overlay olarak görünür.
- **Tam ekran açıkken ajana yazılamaz.** Odak overlay'dedir; geri dönmek için `Esc`'e basın.
- **Terminal:** braille ve blok karakterler yoğun kullanılır; braille'i iyi çizen bir yazı tipiyle truecolor terminal (`COLORTERM=truecolor`) önerilir. Terminal en az 50x14 olmalıdır. TUI olmayan kiplerde HUD kurulmaz.
- **Yerleşik özelliklerle örtüşme:** omp'nin Agent Hub'ı (`Alt+A`) benzer alt ajan verisini gösterir. Editörün üstündeki yerleşik "Subagents" bloğu HUD ile çakışırsa `display.pinnedAgents: off` ayarlayın.

## Sorun giderme

- Hiçbir şey görünmüyorsa: `omp`'yi yeniden başlatın (eklentiler yalnızca başlangıçta yüklenir) ve `/hud help` yazın. Komut bilinmiyorsa eklenti yüklenmemiştir.
- omp günlüklerinde (`~/.omp/logs/`; adlandırılmış profil `~/.omp/profiles/<ad>/logs/` altına yazar) `Failed to load extension` arayın. Tipik nedenler: yanlış ya da taşınmış yol, sembolik bağlantı yerine yönlendirme dosyası (yukarıya bakın).
- Renkler soluksa: terminalde `COLORTERM=truecolor` olmalıdır.
- Yeniden boyutlandırmadan sonra tam ekran bozulursa: bir kez daha boyutlandırıp `/hud` komutunu yeniden verin.

## Geliştirme

```sh
bunx -p typescript tsc --noEmit -p .   # tip denetimi (düz `bunx tsc` yanlış paketi çözer)
bun scripts/smoke-collector.ts         # toplayıcı / mağaza duman testi
bun scripts/preview.ts --live          # gözle bakmak için
```

Henüz test paketi yoktur.

```
index.ts                 eklenti girişi: komutlar, zamanlayıcı
src/types.ts             veri sözleşmesi (HudState, HudStore, HudTheme)
src/store.ts             mağaza
src/collector.ts         omp olaylarını mağazaya yazar
src/demo.ts              /hud demo için sahte olay akışı
src/i18n.ts              en / tr metinleri
src/render/              braille tuval, çekirdek, yörünge, akış, görev, token, yerleşim
src/components/          FullHud (overlay), CompactHud (editörün altındaki widget)
scripts/preview.ts       omp'siz önizleme (kareler / HTML / canlı)
scripts/ansi-to-html.ts  önizleme için ANSI -> HTML dönüştürücü
scripts/shim-pi-tui.ts   düz bun için pi-tui taklidi (yalnız önizleme ve duman testi)
```

## Lisans

[MIT](LICENSE)
