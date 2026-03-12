# Discord Türkçe Kelime Oyunu Botu

Discord sunucuları için geliştirilmiş, TDK doğrulamalı Türkçe kelime zinciri botu.

## Özellikler

- TDK API (`sozluk.gov.tr`) ile kelime doğrulama
- Sunucu bazlı oyun kanalı seçimi
- Slash komutlar ile başlatma, bitirme, durum ve istatistik takibi
- Oyun başında ilk kelimeyi oyun kanalına görünür şekilde duyurma
- Aynı kullanıcı için art arda yazma bekleme süresi (varsayılan 25 sn, ayarlanabilir)
- `-` ile başlayan sohbet mesajlarını oyundan bağımsız bırakma
- Geçersiz kelimede mesaj silme + nedenini embed olarak gösterme
- Oyun verilerini SQLite üzerinde kalıcı tutma

## Hızlı Başlangıç

1) Bağımlılıkları kur:

```bash
npm install
```

2) Ortam değişkenlerini ayarla:

```bash
cp .env.example .env
```

Windows PowerShell alternatifi:

```powershell
Copy-Item .env.example .env
```

3) Botu başlat:

```bash
npm start
```

## Ortam Değişkenleri

```env
DISCORD_TOKEN=your_bot_token
DEV_GUILD_ID=optional_guild_id_for_fast_command_updates
DATABASE_PATH=./data/wordbot.sqlite
CONSECUTIVE_WORD_COOLDOWN_MS=25000
```

- `DISCORD_TOKEN`: Bot token değeri (zorunlu)
- `DEV_GUILD_ID`: Komutların hızlı güncellenmesi için geliştirme sunucusu (opsiyonel)
- `DATABASE_PATH`: SQLite dosya yolu (opsiyonel)
- `CONSECUTIVE_WORD_COOLDOWN_MS`: Aynı kullanıcının tekrar yazma bekleme süresi (ms)

## Gerekli Discord Yetkileri

- View Channels
- Send Messages
- Embed Links
- Add Reactions
- Read Message History
- Manage Messages

Discord Developer Portal tarafında **Message Content Intent** aktif olmalıdır.

## Komutlar

- `/kanal-ayarla kanal:<#kanal>`
- `/oyun-baslat kelime:<kelime>`
- `/oyun-bitir`
- `/oyun-durum`
- `/istatistik`

`/kanal-ayarla`, `/oyun-baslat` ve `/oyun-bitir` komutları varsayılan olarak `Manage Server` yetkisi ister.

## Oyun Kuralları

- Kelime tek parça olmalı ve Türkçe harflerden oluşmalı.
- Yeni kelime, beklenen harf ile başlamalı.
- Aynı kelime aynı oyunda tekrar kullanılamaz.
- Aynı kullanıcı, cooldown süresi dolmadan tekrar kelime gönderemez.

## Geliştirme

- Node.js 18+ önerilir.
- Hızlı sözdizimi kontrolü için:

```bash
node --check src/index.js
```

Katkı vermek için `CONTRIBUTING.md` dosyasına bakabilirsin.

## Lisans

Bu proje `MIT` lisansı ile dağıtılır. Ayrıntılar için `LICENSE` dosyasına bak.
