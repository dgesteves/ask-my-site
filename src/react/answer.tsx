import type { MouseEvent, ReactNode } from 'react';

import type { AskSource } from '../protocol';

export interface AskAnswerProps {
  /** The answer text, possibly still streaming. */
  text: string;
  sources: readonly AskSource[];
  /** Called when a citation is clicked; call `event.preventDefault()` to handle navigation. */
  onNavigate?: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}

const FENCE = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n\1[`~]*[ \t]*(?=\n|$)|$)/gm;
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** The source numbers an answer cites, e.g. `[1]`, `[2][3]` or `[1, 4]`. */
export function citedSourceIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const id of (match[1] ?? '').split(',')) ids.add(Number(id.trim()));
  }
  return ids;
}

/** Allows http(s), mailto, relative and hash links; anything else (javascript:, data:) is dropped. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(?:\/(?!\/)|#|\.{1,2}\/)/.test(trimmed)) return trimmed;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Renders a model answer: paragraphs, bullet and numbered lists, fenced and inline code, bold,
 * links, and `[n]` citations as links to their sources.
 *
 * Model output is untrusted, so this never produces HTML from it: everything is a React text node
 * or element, link targets are allow-listed, and a citation only renders as a link if its number
 * matches a source the server sent.
 */
export function AskAnswer({ text, sources, onNavigate, className }: AskAnswerProps): ReactNode {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const blocks: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(FENCE)) {
    blocks.push(...prose(text.slice(last, match.index), byId, onNavigate, () => key++));
    blocks.push(
      <pre key={`b${String(key++)}`} className="ask-pre">
        <code>{match[2]}</code>
      </pre>,
    );
    last = match.index + match[0].length;
  }
  blocks.push(...prose(text.slice(last), byId, onNavigate, () => key++));
  return <div className={className ?? 'ask-markdown'}>{blocks}</div>;
}

function prose(
  text: string,
  sources: Map<number, AskSource>,
  onNavigate: AskAnswerProps['onNavigate'],
  nextKey: () => number,
): ReactNode[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      const key = `b${String(nextKey())}`;
      const inline = (line: string): ReactNode[] => renderInline(line, sources, onNavigate);
      if (lines.every((line) => /^[-*+]\s+/.test(line))) {
        return (
          <ul key={key}>
            {lines.map((line, i) => (
              <li key={i}>{inline(line.replace(/^[-*+]\s+/, ''))}</li>
            ))}
          </ul>
        );
      }
      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        return (
          <ol key={key}>
            {lines.map((line, i) => (
              <li key={i}>{inline(line.replace(/^\d+[.)]\s+/, ''))}</li>
            ))}
          </ol>
        );
      }
      return <p key={key}>{inline(lines.join(' '))}</p>;
    });
}

function renderInline(
  text: string,
  sources: Map<number, AskSource>,
  onNavigate: AskAnswerProps['onNavigate'],
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [raw, code, bold, label, href, citations] = match;
    if (code !== undefined) {
      out.push(<code key={key++}>{code}</code>);
    } else if (bold !== undefined) {
      out.push(<strong key={key++}>{bold}</strong>);
    } else if (label !== undefined && href !== undefined) {
      const target = safeHref(href);
      out.push(
        target ? (
          <a
            key={key++}
            href={target}
            onClick={(event) => onNavigate?.(target, event)}
            {...(/^https?:/.test(target) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (citations !== undefined) {
      const ids = citations.split(',').map((id) => Number(id.trim()));
      if (ids.every((id) => sources.has(id))) {
        for (const id of ids) {
          const source = sources.get(id);
          if (!source) continue;
          out.push(
            <a
              key={key++}
              className="ask-citation"
              href={source.url}
              title={source.heading ? `${source.title} › ${source.heading}` : source.title}
              aria-label={`Source ${String(id)}: ${source.title}`}
              onClick={(event) => onNavigate?.(source.url, event)}
            >
              {id}
            </a>,
          );
        }
      } else {
        out.push(raw);
      }
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
