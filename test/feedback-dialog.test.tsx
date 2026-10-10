// @vitest-environment jsdom
// Feedback in the dialog: thumbs up and down, then an optional comment, shown only when the
// endpoint takes feedback, and sent to its onFeedback with the answer's id. Requests go to a real
// handler with the mock model.
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { AskDialog, useAsk } from '../src/react';
import { createAskHandler, type AskFeedbackEvent } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

function endpoint(onFeedback?: (event: AskFeedbackEvent) => void) {
  const onFinish = vi.fn();
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    rateLimit: false,
    onFinish,
    ...(onFeedback ? { onFeedback } : {}),
  });
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    return handler(new Request(new URL(url, 'http://localhost'), init));
  });
  return { fetch, onFinish };
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

describe('useAsk.rate', () => {
  it('sends the rating of the answer on screen, with its id, to onFeedback', async () => {
    const onFeedback = vi.fn();
    const { fetch, onFinish } = endpoint(onFeedback);
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('How is an int8 vector scaled?'));
    expect(result.current.feedbackEnabled).toBe(true);
    let taken = false;
    await act(async () => {
      taken = await result.current.rate('up');
    });
    expect(taken).toBe(true);
    expect(result.current.rating).toBe('up');
    await waitFor(() => {
      expect(onFinish).toHaveBeenCalled();
    });
    const finished = onFinish.mock.calls[0]?.[0] as { id: string };
    expect(onFeedback).toHaveBeenCalledWith({
      rating: 'up',
      id: finished.id,
      question: 'How is an int8 vector scaled?',
      answer: result.current.answer,
      sources: result.current.sources.map((source) => source.url),
    });
  });

  it('sends nothing to an endpoint that takes no feedback', async () => {
    const { fetch } = endpoint();
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('How is an int8 vector scaled?'));
    expect(result.current.feedbackEnabled).toBe(false);
    const calls = fetch.mock.calls.length;
    await act(async () => {
      expect(await result.current.rate('down')).toBe(false);
    });
    expect(fetch.mock.calls).toHaveLength(calls);
  });
});

describe('the dialog’s feedback', () => {
  async function answered(onFeedback?: (event: AskFeedbackEvent) => void) {
    const { fetch } = endpoint(onFeedback);
    const user = userEvent.setup();
    render(<AskDialog fetch={fetch} defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How is an int8 vector scaled?{Enter}');
    await waitFor(() => {
      expect(dialog.querySelector('[data-status="done"]')).not.toBeNull();
    });
    return { dialog, user };
  }

  it('asks whether the answer helped, then takes a comment, sent with Enter', async () => {
    const onFeedback = vi.fn();
    const { dialog, user } = await answered(onFeedback);
    expect(within(dialog).getByText('Was this helpful?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'No, it did not help' }));
    expect(await within(dialog).findByText('Thanks for the feedback.')).toBeTruthy();
    expect(onFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ rating: 'down' }));

    await user.click(within(dialog).getByRole('button', { name: 'Add a comment' }));
    const comment = within(dialog).getByRole('textbox', { name: 'Comment' });
    expect(document.activeElement).toBe(comment);
    await user.type(comment, 'It did not say why 127{Enter}');
    expect(await within(dialog).findByText('Thanks for the comment.')).toBeTruthy();
    expect(onFeedback).toHaveBeenCalledTimes(2);
    expect(onFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ rating: 'down', comment: 'It did not say why 127' }),
    );
  });

  it('passes axe with the rating, and with the comment field open', async () => {
    const { dialog, user } = await answered(vi.fn());
    const violations = async () =>
      (await axe.run(dialog)).violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
    expect(await violations()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Yes, it helped' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add a comment' }));
    expect(await violations()).toEqual([]);
  });

  it('offers nothing when the endpoint takes no feedback', async () => {
    const { dialog } = await answered();
    expect(within(dialog).queryByText('Was this helpful?')).toBeNull();
  });

  it('says when the feedback could not be sent', async () => {
    const { dialog, user } = await answered(() => {
      throw new Error('webhook down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.click(within(dialog).getByRole('button', { name: 'Yes, it helped' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The feedback could not be sent.',
    );
    expect(within(dialog).getByText('Was this helpful?')).toBeTruthy();
  });
});
