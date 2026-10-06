import type { SourceDocument } from '../types';

const FIELDS = ['id', 'url', 'title', 'content'] as const;

/**
 * Validates a plain array of `{ id, url, title, content }` records, e.g. from a CMS or a
 * database, and returns them as {@link SourceDocument}s.
 *
 * Throws a `TypeError` naming the offending record and field, and on duplicate ids, because an
 * index silently built from half the content is worse than a failed build.
 */
export function fromDocuments(records: readonly unknown[]): SourceDocument[] {
  if (!Array.isArray(records)) throw new TypeError('Expected an array of documents.');
  const seen = new Set<string>();
  return records.map((record, index) => {
    if (!record || typeof record !== 'object') {
      throw new TypeError(`Document ${String(index)} is not an object.`);
    }
    const fields = record as Record<string, unknown>;
    for (const field of FIELDS) {
      if (typeof fields[field] !== 'string') {
        throw new TypeError(`Document ${String(index)} is missing a string \`${field}\`.`);
      }
    }
    const document: SourceDocument = {
      id: String(fields.id),
      url: String(fields.url),
      title: String(fields.title),
      content: String(fields.content).replace(/\r\n?/g, '\n'),
    };
    if (!document.id) throw new TypeError(`Document ${String(index)} has an empty \`id\`.`);
    if (seen.has(document.id)) throw new TypeError(`Duplicate document id "${document.id}".`);
    seen.add(document.id);
    return document;
  });
}
