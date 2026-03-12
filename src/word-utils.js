const VALID_WORD_REGEX = /^[a-zçğıöşü]+$/u;

const LETTER_REPLACEMENTS = {
  â: "a",
  î: "i",
  û: "u",
};

function normalizeWord(input) {
  if (!input) {
    return "";
  }

  return input
    .toLocaleLowerCase("tr-TR")
    .normalize("NFC")
    .trim()
    .replace(/[âîû]/gu, (letter) => LETTER_REPLACEMENTS[letter] ?? letter);
}

function parseWord(input) {
  const rawValue = (input ?? "").trim();

  if (!rawValue) {
    return {
      ok: false,
      reason: "Bos mesaj gecersiz. Lutfen tek bir kelime yaz.",
    };
  }

  if (/\s/gu.test(rawValue)) {
    return {
      ok: false,
      reason: "Mesaj sadece tek bir kelime olmali.",
    };
  }

  const normalized = normalizeWord(rawValue);

  if (!VALID_WORD_REGEX.test(normalized)) {
    return {
      ok: false,
      reason: "Sadece Turkce harflerden olusan bir kelime yazmalisin.",
    };
  }

  return {
    ok: true,
    normalized,
  };
}

function getExpectedLetter(word) {
  if (!word) {
    return "";
  }

  const lastLetter = word[word.length - 1];
  return lastLetter === "ğ" ? "g" : lastLetter;
}

module.exports = {
  getExpectedLetter,
  normalizeWord,
  parseWord,
};
