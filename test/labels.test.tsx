// @vitest-environment jsdom
// Labels: every string the dialog and its button show or announce comes from `labels`. With every
// label set to a marker, the dialog is driven through each state, and nothing written in English
// is left: only the markers and the content (questions, answers, sources). Requests go to a real
// handler with the mock model.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { scriptOptions } from '../src/embed/script';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog, DEFAULT_LABELS, type AskDialogLabels } from '../src/react';
import { errorText } from '../src/react/dialog-panel';
import { fill, LABEL_NAMES, resolveLabels } from '../src/react/labels';
import { createAskHandler, memoryRateLimit } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** Every label as a marker, keeping its `{name}`s, so a filled-in label still reads as one. */
const MARKERS = Object.fromEntries(
  LABEL_NAMES.map((name) => {
    const template = (DEFAULT_LABELS as Record<string, string | undefined>)[name] ?? '';
    const slots = [...template.matchAll(/\{\w+\}/g)].map((m) => m[0]).join(' ');
    return [name, `⟦${name}${slots ? ` ${slots}` : ''}⟧`];
  }),
) as unknown as AskDialogLabels;
// The server's own words, which the dialog replaces only when given labels for them.
MARKERS.noAnswer = '⟦noAnswer⟧';
MARKERS.rateLimited = '⟦rateLimited⟧';
MARKERS.budgetExceeded = '⟦budgetExceeded⟧';
MARKERS.serverError = '⟦serverError {status}⟧';
MARKERS.answerFailed = '⟦answerFailed⟧';

/** Content: what the reader typed and what the endpoint answered with, left out of the check. */
const CONTENT = [
  '.ask-markdown',
  '.ask-source-title',
  '.ask-source-heading',
  '.ask-source-url',
  '.ask-turn-question',
  '.ask-item-text',
].join(', ');

/**
 * The words in English left in `root`: its text and its labelled attributes, without the markers
 * and without content. Key symbols (↵ ⌘ ✦) and the shortcut's letter are not words.
 */
function english(root: Element): string[] {
  const found: string[] = [];
  const check = (text: string | null, where: string) => {
    const rest = (text ?? '').replace(/⟦[^⟧]*⟧/g, '');
    for (const word of rest.match(/[A-Za-z]{2,}/g) ?? []) found.push(`${where}: ${word}`);
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(CONTENT)) continue;
    check(node.textContent, `text in <${node.parentElement?.tagName.toLowerCase() ?? ''}>`);
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [
      'aria-label',
      'placeholder',
      'title',
      'aria-description',
      'aria-roledescription',
    ]) {
      // A citation's title is its source's title: content.
      if (attribute === 'title' && element.classList.contains('ask-citation')) continue;
      if (element.hasAttribute(attribute)) {
        check(
          element.getAttribute(attribute),
          `${attribute} on <${element.tagName.toLowerCase()}>`,
        );
      }
    }
  }
  return found;
}

function stream(chunks: { delta?: string; finish: 'stop' | 'length' }) {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: chunks.delta ?? 'Scaled to 127 [1].' },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: chunks.finish, raw: chunks.finish },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

function fetchFor(
  overrides: Parameters<typeof createAskHandler>[0] extends infer O ? Partial<O> : never = {},
) {
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    onFeedback: vi.fn(),
    ...overrides,
  });
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    return handler(new Request(new URL(url, 'http://localhost'), init));
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
});

afterEach(() => {
  cleanup();
});

describe('labels', () => {
  it('leave no English in the dialog or its button, in any state', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AskDialog
        fetch={fetchFor()}
        defaultOpen
        launcher
        labels={MARKERS}
        suggestions={['Ερώτηση']}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    const seen = () => [...english(container), ...english(dialog)];
    expect(seen()).toEqual([]);

    // An answer, with its sources, the feedback row, and the footer.
    await user.type(input, 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect(dialog.querySelector('.ask-citation')).not.toBeNull();
    expect(seen()).toEqual([]);

    // A follow-up typed, then asked, so the thread shows.
    await user.clear(input);
    await user.type(input, 'And why int8?');
    expect(seen()).toEqual([]);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(dialog.querySelectorAll('.ask-turn')).toHaveLength(1);
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect(seen()).toEqual([]);

    // A rating, and the comment field.
    await user.click(within(dialog).getByRole('button', { name: MARKERS.notHelpful }));
    await user.click(await within(dialog).findByRole('button', { name: MARKERS.addComment }));
    expect(seen()).toEqual([]);

    // A refusal, whose server text the noAnswer label replaces.
    await user.click(within(dialog).getByRole('button', { name: MARKERS.newQuestion }));
    await user.type(input, 'Who won the 1998 World Cup final?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-refused]')).not.toBeNull();
    });
    expect(dialog.querySelector('.ask-answer')?.textContent).toContain('⟦noAnswer⟧');
    expect(seen()).toEqual([]);
  });

  it('leave no English in a cut-short answer, or an error', async () => {
    const user = userEvent.setup();
    render(
      <AskDialog
        fetch={fetchFor({ model: stream({ finish: 'length' }) })}
        defaultOpen
        labels={MARKERS}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('.ask-truncated')).not.toBeNull();
    });
    expect(english(dialog)).toEqual([]);
    cleanup();

    const offline = vi.fn(() => Promise.reject(new TypeError('offline')));
    render(<AskDialog fetch={offline} defaultOpen labels={MARKERS} />);
    const again = await screen.findByRole('dialog');
    await user.type(within(again).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    expect((await within(again).findByRole('alert')).textContent).toContain('⟦errorNetwork⟧');
    expect(english(again)).toEqual([]);
    cleanup();

    const limited = fetchFor({
      rateLimit: memoryRateLimit({ limit: 1, windowMs: 60_000, key: () => 'x' }),
    });
    render(<AskDialog fetch={limited} defaultOpen labels={MARKERS} />);
    const third = await screen.findByRole('dialog');
    const input = within(third).getByRole('combobox');
    await user.type(input, 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(third.querySelector('[data-status="done"]')).not.toBeNull();
    });
    await user.clear(input);
    await user.type(input, 'What does it cost?{Enter}');
    expect((await within(third).findByRole('alert')).textContent).toContain('⟦rateLimited⟧');
    expect(english(third)).toEqual([]);
  });

  it('fall back to English, and title and placeholder win over theirs', async () => {
    render(
      <AskDialog
        fetch={fetchFor()}
        defaultOpen
        launcher
        title="Ask Acme"
        labels={{
          placeholder: 'Pose une question…',
          launcher: 'Demander',
          title: 'Demander à Acme',
        }}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox').getAttribute('placeholder')).toBe(
      'Pose une question…',
    );
    expect(screen.getByRole('dialog', { name: 'Ask Acme' })).toBeTruthy();
    expect(within(dialog).getByText(DEFAULT_LABELS.footer)).toBeTruthy();
    // The open dialog hides the page, the button with it, from assistive technology.
    expect(screen.getByRole('button', { name: /Demander/, hidden: true })).toBeTruthy();
  });
});

describe('the docs', () => {
  it('list every label, with its default', () => {
    const page = readFileSync(
      join(import.meta.dirname, '../examples/nextjs/content/docs/ask-dialog.md'),
      'utf8',
    );
    const rows = new Map(
      [...page.matchAll(/^\| `(\w+)` +\| (.+?) +\|$/gm)].map((m) => [m[1], m[2]]),
    );
    for (const name of LABEL_NAMES) {
      const value = (DEFAULT_LABELS as Record<string, string | undefined>)[name];
      expect([name, rows.get(name)]).toEqual([name, value ?? "the endpoint's own words"]);
    }
  });
});

describe('the endpoint’s own words', () => {
  const labels = resolveLabels({});
  it('show as the endpoint sends them, unless a label is given for them', () => {
    const budget = {
      kind: 'rate-limited' as const,
      code: 'budget_exceeded',
      message: 'Daily limit.',
    };
    expect(errorText(budget, labels)).toBe('Daily limit.');
    expect(errorText(budget, resolveLabels({ budgetExceeded: 'Limite du jour.' }))).toBe(
      'Limite du jour.',
    );
    const http = {
      kind: 'http' as const,
      status: 400,
      message: 'Questions are limited to 500 characters.',
    };
    expect(errorText(http, labels)).toBe('Questions are limited to 500 characters.');
    expect(errorText(http, resolveLabels({ serverError: 'Erreur {status}.' }))).toBe('Erreur 400.');
    expect(
      errorText({ kind: 'http', status: 404, message: 'x', reason: 'unavailable' }, labels),
    ).toBe(DEFAULT_LABELS.errorUnavailable);
    expect(errorText({ kind: 'stream', message: 'x', reason: 'cut-off' }, labels)).toBe(
      DEFAULT_LABELS.errorCutOff,
    );
  });

  it('fills in a label’s names, and leaves unknown ones', () => {
    expect(fill('Citing {count} sources, {count} in all, {x}', { count: 3 })).toBe(
      'Citing 3 sources, 3 in all, {x}',
    );
  });
});

describe('the script tag’s labels', () => {
  it('reads data-labels and data-label-*, the attributes over the JSON, and data-locale', () => {
    const options = scriptOptions({
      labels: '{"launcher":"Demander","newQuestion":"Nouvelle question","stop":3}',
      labelNewQuestion: 'Autre question',
      labelPlaceholder: 'Pose une question…',
      locale: 'fr',
    });
    expect(options.labels).toEqual({
      launcher: 'Demander',
      newQuestion: 'Autre question',
      placeholder: 'Pose une question…',
    });
    expect(options.locale).toBe('fr');
  });

  it('warns about data-labels that are not a JSON object, and ignores them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(scriptOptions({ labels: '["Demander"]' }).labels).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('data-labels must be a JSON object'));
  });
});
