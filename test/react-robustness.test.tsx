// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AskAnswer, AskDialog, safeHref, useAsk } from '../src/react';

beforeAll(() => {
  // jsdom lacks these; cmdk and Radix call them.
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
  vi.unstubAllGlobals();
});

const encoder = new TextEncoder();
const sse = (part: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(part)}\n\n`);

/** A fetch whose response streams `parts`, then either finishes or stays open. */
function streamingFetch(parts: unknown[], { close = true } = {}) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) controller.enqueue(sse(part));
            if (close) controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ),
  );
}

describe('AskAnswer rendering', () => {
  it('renders a multi-line code block whole, and an unfinished one while it streams', () => {
    const { container, rerender } = render(
      <AskAnswer
        text={'Before.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nAfter.'}
        sources={[]}
      />,
    );
    expect([...container.querySelectorAll('pre')].map((pre) => pre.textContent)).toEqual([
      'const a = 1;\nconst b = 2;',
    ]);
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Before.',
      'After.',
    ]);
    rerender(<AskAnswer text={'```sh\npnpm add ask-my-site\npnpm'} sources={[]} />);
    expect(container.querySelector('pre')?.textContent).toBe('pnpm add ask-my-site\npnpm');
  });

  it('splits an intro line from the list that follows it', () => {
    const { container } = render(
      <AskAnswer text={'To install:\n1. Run the CLI\n2. Import it\nThen deploy.'} sources={[]} />,
    );
    expect(container.querySelector('p')?.textContent).toBe('To install:');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('p')[1]?.textContent).toBe('Then deploy.');
  });

  it('never links to unsafe source URLs', () => {
    render(
      <AskAnswer
        text="See [1] and [2]."
        sources={[
          { id: 1, url: 'javascript:alert(1)', title: 'Evil', heading: '' },
          { id: 2, url: '/\\evil.example', title: 'Sneaky', heading: '' },
        ]}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.body.textContent).toBe('See [1] and [2].');
  });

  it('allow-lists hrefs, rejecting protocol-relative tricks', () => {
    expect(safeHref('/docs/a#b')).toBe('/docs/a#b');
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/\\evil.example')).toBeNull();
    expect(safeHref('/\t/evil.example')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
  });
});

describe('useAsk edge cases', () => {
  it('stop() keeps text that has not been rendered yet', async () => {
    // Frames never run, so nothing reaches state through the scheduler.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const fetch = streamingFetch(
      [
        { type: 'start', messageMetadata: { refused: false, retrieval: 'hybrid' } },
        { type: 'text-delta', id: 't', delta: 'Partial answer' },
        { type: 'text-delta', id: 't', delta: ' plus more' },
      ],
      { close: false },
    );
    const { result } = renderHook(() => useAsk({ fetch }));
    act(() => {
      void result.current.ask('q');
    });
    await waitFor(() => {
      expect(result.current.retrieval).toBe('hybrid');
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe('done');
    expect(result.current.answer).toBe('Partial answer plus more');
  });

  it('reports a stream that ends without finishing as cut off', async () => {
    const fetch = streamingFetch([
      { type: 'start', messageMetadata: { refused: false, retrieval: 'hybrid' } },
      { type: 'text-delta', id: 't', delta: 'Half an ans' },
    ]);
    const { result } = renderHook(() => useAsk({ fetch }));
    await act(() => result.current.ask('q'));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatchObject({ kind: 'stream' });
    expect(result.current.error?.message).toMatch(/cut off/);
    expect(result.current.answer).toBe('Half an ans');
  });

  it('does not report a superseded request through onFinish', async () => {
    let releaseError!: () => void;
    const slowError = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          releaseError = () => {
            controller.enqueue(encoder.encode('{"error":{"message":"boom"}}'));
            controller.close();
          };
        },
      }),
      { status: 500 },
    );
    const second = streamingFetch([
      { type: 'start', messageMetadata: { refused: false, retrieval: 'hybrid' } },
      { type: 'text-delta', id: 't', delta: 'B' },
      { type: 'finish' },
    ]);
    const fetch = vi.fn().mockResolvedValueOnce(slowError).mockImplementation(second);
    const onFinish = vi.fn();
    const { result } = renderHook(() => useAsk({ fetch, onFinish }));

    let first!: Promise<void>;
    act(() => {
      first = result.current.ask('question A');
    });
    await act(() => result.current.ask('question B'));
    releaseError();
    await act(() => first);

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]?.[0]).toMatchObject({ question: 'question B', status: 'done' });
  });
});

describe('AskDialog in controlled mode', () => {
  it('returns focus to the opener when the parent opens and closes it', async () => {
    const user = userEvent.setup();
    function Parent() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Open
          </button>
          <AskDialog open={open} onOpenChange={setOpen} fetch={streamingFetch([])} />
        </>
      );
    }
    render(<Parent />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
  });
});
