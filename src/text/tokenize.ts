/**
 * The tokenizer shared by BM25 (index and query side) and the mock embedding model.
 *
 * It is deliberately small: Unicode-aware word splitting, diacritic folding, an English stopword
 * list, camelCase expansion for code identifiers, and plural stripping. Anything smarter
 * (real stemming, language detection) belongs in the embedding model, which already handles it.
 */

const STOPWORDS = new Set(
  (
    'a about above after again against all am an and any are as at be because been before being ' +
    'below between both but by can could did do does doing down during each few for from further ' +
    'had has have having he her here hers herself him himself his how i if in into is it its ' +
    'itself just me more most my myself no nor not now of off on once only or other our ours ' +
    'ourselves out over own same she should so some such than that the their theirs them ' +
    'themselves then there these they this those through to too under until up very was we were ' +
    'what when where which while who whom why will with would you your yours yourself yourselves ' +
    'also may might must shall tell please using use used get got'
  ).split(' '),
);

const WORD = /[\p{L}\p{N}]+/gu;
// Hot path: most text is ASCII plus typographic punctuation (› — “ ” → …), and the Unicode work
// below is the slow part of loading an index. Punctuation only ever separates words, so text whose
// only non-ASCII characters are punctuation can take the ASCII scanner and tokenize identically.
// eslint-disable-next-line no-control-regex
const NEEDS_UNICODE = /[^\x00-\x7f\u00a0\u00ab\u00b7\u00bb\u2000-\u206f\u2190-\u21ff]/;
const HAS_CAMEL = /[\p{Ll}\p{N}]\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;
const CAMEL_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const DIACRITICS = /\p{M}+/gu;
// "don't" and "dont" should match, so apostrophes inside a word are dropped rather than split on.
const INNER_APOSTROPHE = /(?<=[\p{L}\p{N}])['\u2019](?=[\p{L}\p{N}])/gu;

const CHAR_S = 115;
const CHAR_U = 117;
const CHAR_I = 105;

/** Stopword removal and plural stripping (`-s`, but not `-ss`, `-us` or `-is`) on a lowercase word. */
function normalizeTerm(term: string): string | null {
  const length = term.length;
  if (length < 2 || STOPWORDS.has(term)) return null;
  if (length > 3 && term.charCodeAt(length - 1) === CHAR_S) {
    const previous = term.charCodeAt(length - 2);
    if (previous !== CHAR_S && previous !== CHAR_U && previous !== CHAR_I) {
      return term.slice(0, -1);
    }
  }
  return term;
}

function pushWord(terms: string[], word: string, hasUpper: boolean): void {
  const lower = hasUpper ? word.toLowerCase() : word;
  const whole = normalizeTerm(lower);
  if (whole) terms.push(whole);
  if (hasUpper && HAS_CAMEL.test(word)) {
    for (const part of word.split(CAMEL_BOUNDARY)) {
      const term = normalizeTerm(part.toLowerCase());
      if (term && term !== whole) terms.push(term);
    }
  }
}

/**
 * Splits text into normalized terms.
 *
 * `createAskHandler` yields `createaskhandler`, `create`, `ask` and `handler`, so a query can match
 * an identifier whole or by its parts.
 */
export function tokenize(text: string): string[] {
  let input = text;
  if (input.includes("'") || input.includes('\u2019')) input = input.replace(INNER_APOSTROPHE, '');
  const terms: string[] = [];

  if (NEEDS_UNICODE.test(input)) {
    input = input.normalize('NFKD').replace(DIACRITICS, '');
    for (const match of input.matchAll(WORD)) {
      const word = match[0];
      pushWord(terms, word, word !== word.toLowerCase());
    }
    return terms;
  }

  // ASCII fast path: a character scanner, no regex match objects. Loading an index tokenizes
  // every chunk, so this loop dominates cold-start time.
  const length = input.length;
  let i = 0;
  while (i < length) {
    let code = input.charCodeAt(i);
    while (i < length && !isWordChar(code)) code = input.charCodeAt(++i);
    const start = i;
    let hasUpper = false;
    while (i < length && isWordChar(code)) {
      if (code <= 90 && code >= 65) hasUpper = true;
      code = input.charCodeAt(++i);
    }
    if (i > start) pushWord(terms, input.slice(start, i), hasUpper);
  }
  return terms;
}

/** [A-Za-z0-9] */
function isWordChar(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57);
}
