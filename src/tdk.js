const https = require("node:https");

const BASE_URL = "https://sozluk.gov.tr/gts?ara=";
const SUCCESS_CACHE_TTL = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL = 5 * 60 * 1000;

const cache = new Map();

function simplifyTurkishChars(word) {
  return (word ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[âîû]/gu, (letter) => {
      if (letter === "â") {
        return "a";
      }
      if (letter === "î") {
        return "i";
      }
      return "u";
    });
}

function removeHtmlTags(text) {
  return String(text ?? "").replace(/<[^>]*>/gu, "").trim();
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
            reject(new Error(`TDK HTTP hatasi: ${response.statusCode}`));
            return;
          }

          if (!body) {
            resolve({ error: "Sonuc bulunamadi" });
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("TDK yaniti parse edilemedi"));
          }
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(8000, () => {
      request.destroy(new Error("TDK istegi zaman asimina ugradi"));
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

    if (!Array.isArray(data) || data.length === 0) {
      const invalidResult = buildResult(
        false,
        "Kelime TDK sozlugunde bulunamadi."
      );

      cache.set(word, {
        value: invalidResult,
        expiresAt: now + FAILURE_CACHE_TTL,
      });
      pruneCache();
      return invalidResult;
    }

    const normalizedTarget = simplifyTurkishChars(word);
    const exactMatch = data.some((entry) => {
      const candidate =
        removeHtmlTags(entry?.madde_duz) || removeHtmlTags(entry?.madde);

      return simplifyTurkishChars(candidate) === normalizedTarget;
    });

    const validResult = exactMatch
      ? buildResult(true, null)
      : buildResult(false, "Kelime TDK sozlugunde bulunamadi.");

    cache.set(word, {
      value: validResult,
      expiresAt: now + (validResult.valid ? SUCCESS_CACHE_TTL : FAILURE_CACHE_TTL),
    });
    pruneCache();

    return validResult;
  } catch (_error) {
    return buildResult(
      false,
      "TDK dogrulamasi su anda yapilamiyor. Lutfen biraz sonra tekrar dene."
    );
  }
}

module.exports = {
  validateWithTdk,
};
