const https = require("node:https");

const BASE_URL = "https://sozluk.gov.tr/gts?ara=";
const SUCCESS_CACHE_TTL = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL = 60 * 1000;

const DIACRITIC_REPLACEMENTS = {
  â: "a",
  î: "i",
  û: "u",
  ê: "e",
  ô: "o",
};

const cache = new Map();

function simplifyTurkishChars(word) {
  return (word ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[âîûêô]/gu, (letter) => DIACRITIC_REPLACEMENTS[letter] ?? letter);
}

function removeHtmlTags(text) {
  return String(text ?? "").replace(/<[^>]*>/gu, "").trim();
}

function normalizeDictionaryWord(value) {
  return simplifyTurkishChars(removeHtmlTags(value).normalize("NFC"));
}

function compactWord(value) {
  return normalizeDictionaryWord(value).replace(/[^a-zçğıöşü]/gu, "");
}

function hasMatchingEntry(entries, targetWord) {
  const normalizedTarget = normalizeDictionaryWord(targetWord);
  const compactTarget = compactWord(targetWord);

  return entries.some((entry) => {
    const candidates = [entry?.madde_duz, entry?.madde];

    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeDictionaryWord(candidate);
      if (!normalizedCandidate) {
        return false;
      }

      if (normalizedCandidate === normalizedTarget) {
        return true;
      }

      const compactCandidate = compactWord(candidate);
      return Boolean(compactCandidate) && compactCandidate === compactTarget;
    });
  });
}

function pruneCache() {
  const now = Date.now();

  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }

  if (cache.size <= 1500) {
    return;
  }

  let itemsToDelete = cache.size - 1500;
  for (const key of cache.keys()) {
    cache.delete(key);
    itemsToDelete -= 1;
    if (itemsToDelete <= 0) {
      break;
    }
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "discord-word-bot/1.0",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`TDK HTTP hatası: ${response.statusCode}`));
            return;
          }

          if (!body) {
            resolve({ error: "Sonuç bulunamadı" });
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("TDK yanıtı ayrıştırılamadı"));
          }
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(8000, () => {
      request.destroy(new Error("TDK isteği zaman aşımına uğradı"));
    });
  });
}

function buildResult(valid, reason) {
  return {
    valid,
    reason,
  };
}

async function validateWithTdk(word) {
  const now = Date.now();
  const cached = cache.get(word);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const data = await fetchJson(`${BASE_URL}${encodeURIComponent(word)}`);

    if (
      !Array.isArray(data) ||
      data.length === 0 ||
      data.every((entry) => entry?.error)
    ) {
      const invalidResult = buildResult(
        false,
        "Kelime TDK sözlüğünde bulunamadı."
      );

      cache.set(word, {
        value: invalidResult,
        expiresAt: now + FAILURE_CACHE_TTL,
      });
      pruneCache();
      return invalidResult;
    }

    const exactMatch = hasMatchingEntry(data, word);

    const validResult = exactMatch
      ? buildResult(true, null)
      : buildResult(false, "Kelime TDK sözlüğünde bulunamadı.");

    cache.set(word, {
      value: validResult,
      expiresAt: now + (validResult.valid ? SUCCESS_CACHE_TTL : FAILURE_CACHE_TTL),
    });
    pruneCache();

    return validResult;
  } catch (_error) {
    return buildResult(
      false,
      "TDK doğrulaması şu anda yapılamıyor. Lütfen biraz sonra tekrar dene."
    );
  }
}

module.exports = {
  validateWithTdk,
};
