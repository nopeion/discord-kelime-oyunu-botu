# Katkı Rehberi

Projeye katkı vermek istediğin için teşekkürler.

## Geliştirme Ortamı

1. Depoyu forkla ve klonla.
2. Bağımlılıkları yükle:

```bash
npm install
```

3. `.env.example` dosyasını kopyalayıp `.env` oluştur.

## Branch ve Commit

- Her iş için ayrı branch aç:
  - `feat/kisa-aciklama`
  - `fix/kisa-aciklama`
- Commit mesajlarında mümkünse Conventional Commit kullan:
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`

## Kod Standartları

- Mevcut kod stilini koru.
- Gereksiz büyük refactorlardan kaçın.
- Özellik değişikliklerinde kullanıcıya görünen metinleri Türkçe ve tutarlı bırak.

## Pull Request Süreci

PR açmadan önce:

- Değişikliklerin amacını kısa ve net yaz.
- Etkilenen dosyaları ve davranışı açıklamaya ekle.
- Mümkünse kısa test adımları ver.

Örnek kontrol:

```bash
node --check src/index.js
```

## Hata Bildirimi ve Özellik Talebi

- Hatalar için `Bug report` template'ini,
- Öneriler için `Feature request` template'ini kullan.
