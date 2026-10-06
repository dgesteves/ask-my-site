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
const CAMEL_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const DIACRITICS = /\p{M}+/gu;
const PLURAL_GUARD = /(?:ss|us|is)$/;

function normalizeTerm(raw: string): string | null {
  const term = raw.toLowerCase();
  if (term.length < 2 || STOPWORDS.has(term)) return null;
  if (term.length > 3 && term.endsWith('s') && !PLURAL_GUARD.test(term)) return term.slice(0, -1);
  return term;
}

/**
 * Splits text into normalized terms.
 *
 * `createAskHandler` yields `createaskhandler`, `create`, `ask` and `handler`, so a query can match
 * an identifier whole or by its parts.
 */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  const folded = text.normalize('NFKD').replace(DIACRITICS, '');
  for (const match of folded.matchAll(WORD)) {
    const word = match[0];
    const whole = normalizeTerm(word);
    if (whole) terms.push(whole);
    const parts = word.split(CAMEL_BOUNDARY);
    if (parts.length > 1) {
      for (const part of parts) {
        const term = normalizeTerm(part);
        if (term && term !== whole) terms.push(term);
      }
    }
  }
  return terms;
}
