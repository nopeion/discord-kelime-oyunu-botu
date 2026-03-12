# Discord Kelime Botu

Bu bot, Türkçe kelime zinciri oyununu Discord sunucularında oynatır.

## Özellikler

- TDK API ile kelime doğrulama (`sozluk.gov.tr`)
- Sunucu bazlı oyun kanalı ayarı
- Slash komutlar ile oyun başlatma/bitirme/durum/istatistik
- Geçersiz kelimede:
  - kullanıcının mesajı silinir
  - neden embed olarak gönderilir
  - embed 10 saniye sonra silinir
- Geçerli kelimede sadece `✅` reaksiyonu eklenir
- Oyun ilerlemesi ve istatistikler SQLite veritabanında tutulur
- `ğ` ile biten kelimelerde sonraki harf `g` olarak kabul edilir
- Aynı kullanıcı arka arkaya yazabilir ama bekleme süresi vardır (varsayılan 25 sn)

## Kurulum

1. Bağımlılıkları kur:

```bash
npm install
```

Node.js 18+ önerilir.

2. Ortam değişkenlerini ayarla:

```bash
cp .env.example .env
```

Windows PowerShell için alternatif:

```powershell
Copy-Item .env.example .env
```

`.env` içine bot token değerini yaz:

```env
DISCORD_TOKEN=your_bot_token
DEV_GUILD_ID=optional_guild_id_for_fast_command_updates
DATABASE_PATH=./data/wordbot.sqlite
CONSECUTIVE_WORD_COOLDOWN_MS=25000
```

3. Botu başlat:

```bash
npm start
```

## Gerekli Discord Yetkileri

Botun davetinde şu yetkiler olmalı:

- View Channels
- Send Messages
- Embed Links
- Add Reactions
- Read Message History
- Manage Messages (geçersiz mesajları silmek için)

Ayrıca Developer Portal tarafında **Message Content Intent** aktif olmalı.

## Komutlar

- `/kanal-ayarla kanal:<#kanal>`
- `/oyun-baslat kelime:<kelime>`
- `/oyun-bitir`
- `/oyun-durum`
- `/istatistik`

`/kanal-ayarla`, `/oyun-baslat` ve `/oyun-bitir` komutları varsayılan olarak `Manage Server` yetkisi ister.
