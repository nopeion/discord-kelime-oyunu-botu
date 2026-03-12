# Discord Kelime Botu

Bu bot, Turkce kelime zinciri oyununu Discord sunucularinda oynatir.

## Ozellikler

- TDK API ile kelime dogrulama (`sozluk.gov.tr`)
- Sunucu bazli oyun kanali ayari
- Slash komutlar ile oyun baslatma/bitirme/durum/istatistik
- Gecersiz kelimede:
  - kullanicinin mesaji silinir
  - neden embed olarak gonderilir
  - embed 10 saniye sonra silinir
- Gecerli kelimede sadece `✅` reaksiyonu eklenir
- Oyun ilerlemesi ve istatistikler SQLite veritabaninda tutulur
- `ğ` ile biten kelimelerde sonraki harf `g` olarak kabul edilir

## Kurulum

1. Bagimliliklari kur:

```bash
npm install
```

Node.js 18+ onerilir.

2. Ortam degiskenlerini ayarla:

```bash
cp .env.example .env
```

Windows PowerShell icin alternatif:

```powershell
Copy-Item .env.example .env
```

`.env` icine bot token degerini yaz:

```env
DISCORD_TOKEN=your_bot_token
DEV_GUILD_ID=optional_guild_id_for_fast_command_updates
DATABASE_PATH=./data/wordbot.sqlite
```

3. Botu baslat:

```bash
npm start
```

## Gerekli Discord Yetkileri

Botun davetinde su yetkiler olmali:

- View Channels
- Send Messages
- Embed Links
- Add Reactions
- Read Message History
- Manage Messages (gecersiz mesajlari silmek icin)

Ayrica Developer Portal tarafinda **Message Content Intent** aktif olmali.

## Komutlar

- `/kanal-ayarla kanal:<#kanal>`
- `/oyun-baslat kelime:<kelime>`
- `/oyun-bitir`
- `/oyun-durum`
- `/istatistik`

`/kanal-ayarla`, `/oyun-baslat` ve `/oyun-bitir` komutlari varsayilan olarak `Manage Server` yetkisi ister.
