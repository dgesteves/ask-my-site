// @vitest-environment jsdom
// The dialog keeps the thread: each question after the first is sent with the ones before it, so
// the endpoint can answer a follow-up; every answer keeps its own citations; "New question" starts
// over. Requests go to a real handler with the mock model, which rewrites follow-ups too.
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog, useAsk } from '../src/react';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** A fetch that routes to a real handler with the mock model, recording the bodies it sent. */
function handlerFetch() {
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
  });
  const bodies: unknown[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
    const url = input instanceof Request ? input.url : input;
    return handler(new Request(new URL(url, 'http://localhost'), init));
  });
  return { fetch, bodies };
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

const text = (value: string) => [{ type: 'text', text: value }];

describe('useAsk keeps the thread', () => {
  it('asks the first question on its own, and the next one with the thread', async () => {
    const { fetch, bodies } = handlerFetch();
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('How do I keep a token bucket per client IP in memory?'));
    const first = result.current.answer;
    await act(() => result.current.ask('And with Upstash?'));

    expect(bodies[0]).toEqual({
      question: 'How do I keep a token bucket per client IP in memory?',
    });
    expect(bodies[1]).toEqual({
      messages: [
        { role: 'user', parts: text('How do I keep a token bucket per client IP in memory?') },
        { role: 'assistant', parts: text(first) },
        { role: 'user', parts: text('And with Upstash?') },
      ],
    });
    expect(result.current.turns).toEqual([
      expect.objectContaining({
        question: 'How do I keep a token bucket per client IP in memory?',
        answer: first,
        refused: false,
      }),
    ]);
    // The endpoint rewrote the follow-up, so the answer comes from the in-memory section too.
    expect(result.current.sources.map((source) => source.url)).toContain(
      '/docs/rate-limits#in-memory',
    );
  });

  it('sends at most the last three questions with their answers', async () => {
    const { fetch, bodies } = handlerFetch();
    const { result } = renderHook(() => useAsk({ fetch }));
    for (const question of [
      'What does it cost?',
      'How do I install it?',
      'Which Node.js?',
      'And Bun?',
      'And Deno?',
    ]) {
      await act(() => result.current.ask(question));
    }
    const last = bodies.at(-1) as { messages: { role: string }[] };
    expect(last.messages).toHaveLength(7);
    expect(result.current.turns).toHaveLength(4);
  });

  it('starts a new thread on reset, and keeps none with followUps: false', async () => {
    const { fetch, bodies } = handlerFetch();
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('What does it cost?'));
    act(() => {
      result.current.reset();
    });
    await act(() => result.current.ask('How do I install it?'));
    expect(bodies[1]).toEqual({ question: 'How do I install it?' });

    const single = handlerFetch();
    const { result: off } = renderHook(() => useAsk({ fetch: single.fetch, followUps: false }));
    await act(() => off.current.ask('What does it cost?'));
    await act(() => off.current.ask('And with Upstash?'));
    expect(single.bodies[1]).toEqual({ question: 'And with Upstash?' });
    expect(off.current.turns).toEqual([]);
  });

  it('leaves an answer that failed out of the thread', async () => {
    let fail = true;
    const { fetch: real } = handlerFetch();
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      fail ? Promise.reject(new TypeError('offline')) : real(input, init),
    );
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('What does it cost?'));
    expect(result.current.status).toBe('error');
    fail = false;
    await act(() => result.current.ask('What does it cost?'));
    expect(result.current.turns).toEqual([]);
  });
});

describe('the dialog’s thread', () => {
  it('shows each earlier question and answer, with its own citations, and follows up', async () => {
    const { fetch, bodies } = handlerFetch();
    const user = userEvent.setup();
    render(<AskDialog fetch={fetch} defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    await user.type(input, 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });

    await user.clear(input);
    await user.type(input, 'And why int8?');
    expect(within(dialog).getByRole('option').textContent).toContain('Follow up');
    // The answer stays on screen while the follow-up is typed.
    expect(dialog.querySelector('.ask-answer')).not.toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(dialog.querySelectorAll('.ask-turn')).toHaveLength(1);
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect((bodies[1] as { messages: unknown[] }).messages).toHaveLength(3);

    const turn = dialog.querySelector('.ask-turn')!;
    expect(turn.querySelector('.ask-turn-question')?.textContent).toBe(
      'How is an int8 vector scaled?',
    );
    // An earlier answer's citation opens its own source.
    const citation = turn.querySelector('a.ask-citation');
    expect(citation?.getAttribute('href')).toMatch(/^\/docs\/quantization/);
    expect(
      [...dialog.querySelectorAll('.ask-turn-question')].map((node) => node.textContent),
    ).toEqual(['How is an int8 vector scaled?', 'And why int8?']);
  });

  it('starts over with New question, asking the next question on its own', async () => {
    const { fetch, bodies } = handlerFetch();
    const user = userEvent.setup();
    render(<AskDialog fetch={fetch} defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    await user.type(input, 'What does it cost?{Enter}');
    await user.click(await within(dialog).findByRole('button', { name: 'New question' }));
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
    expect(dialog.querySelector('.ask-answer')).toBeNull();

    await user.type(input, 'How do I install it?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    expect(bodies[1]).toEqual({ question: 'How do I install it?' });
    expect(dialog.querySelectorAll('.ask-turn')).toHaveLength(0);
  });
});
