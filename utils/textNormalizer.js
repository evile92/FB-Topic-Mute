(function (global) {
  'use strict';

  const FBMute = (global.FBMute = global.FBMute || {});

  // Arabic diacritics (tashkeel), superscript alef, tatweel (kashida), and invisible zero-width marks
  const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640\u200B-\u200D\uFEFF\u00AD]/g;
  const ARABIC_ALEF_RE = /[\u0622\u0623\u0625\u0671]/g; // آ أ إ ٱ -> ا
  const ARABIC_TEH_MARBUTA_RE = /\u0629/g;              // ة -> ه
  const ARABIC_ALEF_MAKSURA_RE = /\u0649/g;             // ى -> ي
  const WHITESPACE_RE = /\s+/g;
  const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
  const BULK_SPLIT_RE = /[,،\r\n]+/;

  /**
   * Normalize Arabic & English text consistently for both keywords and post content.
   * @param {string} input
   * @returns {string}
   */
  function normalize(input) {
    if (typeof input !== 'string' || input.length === 0) {
      return '';
    }

    let text = input;
    if (typeof text.normalize === 'function') {
      text = text.normalize('NFKC');
    }

    return text
      .replace(ARABIC_DIACRITICS_RE, '')
      .replace(ARABIC_ALEF_RE, '\u0627')
      .replace(ARABIC_TEH_MARBUTA_RE, '\u0647')
      .replace(ARABIC_ALEF_MAKSURA_RE, '\u064A')
      .toLowerCase()
      .replace(WHITESPACE_RE, ' ')
      .trim();
  }

  /**
   * Escape all RegExp metacharacters in a user-provided string.
   * @param {string} str
   * @returns {string}
   */
  function escapeRegExp(str) {
    return str.replace(REGEX_ESCAPE_RE, '\\$&');
  }

  /**
   * Build a Unicode-safe whole-word regex for an already normalized keyword.
   * Uses Unicode property escapes instead of \b so Arabic and non-ASCII words work accurately.
   * @param {string} normalizedKeyword
   * @returns {RegExp|null}
   */
  function buildWholeWordRegex(normalizedKeyword) {
    if (!normalizedKeyword) return null;
    try {
      const escaped = escapeRegExp(normalizedKeyword);
      return new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '($|[^\\p{L}\\p{N}_])', 'u');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Pre-compile a fast matcher object for a list of raw keywords and a match mode.
   * @param {string[]} keywords
   * @param {'partial'|'whole-word'} matchType
   * @returns {{ findMatch: (normalizedText: string) => { raw: string, normalized: string } | null, hasKeywords: boolean, size: number }}
   */
  function compileMatcher(keywords, matchType) {
    const entries = [];
    const seen = new Set();
    const isWholeWord = matchType === 'whole-word';

    if (Array.isArray(keywords)) {
      for (let i = 0; i < keywords.length; i++) {
        const raw = typeof keywords[i] === 'string' ? keywords[i].trim() : '';
        if (!raw) continue;

        const norm = normalize(raw);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);

        if (isWholeWord) {
          const regex = buildWholeWordRegex(norm);
          if (regex) {
            entries.push({ raw, normalized: norm, regex });
          }
        } else {
          entries.push({ raw, normalized: norm, regex: null });
        }
      }
    }

    function findMatch(normalizedText) {
      if (!normalizedText || entries.length === 0) {
        return null;
      }

      if (isWholeWord) {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.regex && entry.regex.test(normalizedText)) {
            return { raw: entry.raw, normalized: entry.normalized };
          }
        }
      } else {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (normalizedText.includes(entry.normalized)) {
            return { raw: entry.raw, normalized: entry.normalized };
          }
        }
      }

      return null;
    }

    return {
      findMatch,
      hasKeywords: entries.length > 0,
      size: entries.length
    };
  }

  /**
   * Split user input into individual cleaned phrases (supports English comma, Arabic comma, and newlines).
   * @param {string} rawInput
   * @returns {string[]}
   */
  function parseKeywordInput(rawInput) {
    if (typeof rawInput !== 'string') return [];
    return rawInput
      .split(BULK_SPLIT_RE)
      .map(function (part) {
        return part.replace(WHITESPACE_RE, ' ').trim();
      })
      .filter(function (part) {
        return part.length > 0;
      });
  }

  /**
   * Merge incoming keywords with existing keywords while deduplicating after normalization.
   * @param {string[]} existingList
   * @param {string[]} incomingList
   * @returns {{ merged: string[], addedCount: number, skippedCount: number }}
   */
  function mergeUniqueKeywords(existingList, incomingList) {
    const merged = [];
    const seen = new Set();

    if (Array.isArray(existingList)) {
      for (let i = 0; i < existingList.length; i++) {
        const raw = typeof existingList[i] === 'string'
          ? existingList[i].replace(WHITESPACE_RE, ' ').trim()
          : '';
        if (!raw) continue;
        const norm = normalize(raw);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        merged.push(raw);
      }
    }

    let addedCount = 0;
    let skippedCount = 0;

    if (Array.isArray(incomingList)) {
      for (let i = 0; i < incomingList.length; i++) {
        const raw = typeof incomingList[i] === 'string'
          ? incomingList[i].replace(WHITESPACE_RE, ' ').trim()
          : '';
        if (!raw) continue;
        const norm = normalize(raw);
        if (!norm) continue;
        if (seen.has(norm)) {
          skippedCount++;
          continue;
        }
        seen.add(norm);
        merged.push(raw);
        addedCount++;
      }
    }

    return { merged, addedCount, skippedCount };
  }

  /**
   * Compute a fast deterministic signature (length + FNV-1a 32-bit hash) for WeakMap change detection.
   * @param {string} text
   * @returns {string}
   */
  function computeSignature(text) {
    if (!text) return '0:0';
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return text.length + ':' + (hash >>> 0).toString(36);
  }

  FBMute.TextNormalizer = {
    normalize,
    escapeRegExp,
    buildWholeWordRegex,
    compileMatcher,
    parseKeywordInput,
    mergeUniqueKeywords,
    computeSignature
  };
})(window);
