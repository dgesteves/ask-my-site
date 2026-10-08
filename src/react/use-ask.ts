import { useCallback, useEffect, useRef, useState } from 'react';

import type { AskErrorBody, AskSource } from '../protocol';
import { readAskStream } from './stream';

export type AskStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export interface AskError {
  /** `rate-limited` (429), `http` (other non-2xx), `network` (no response), `stream` (failed mid-answer). */
  kind: 'rate-limited' | 'http' | 'network' | 'stream';
  message: string;
  status?: number;
  /** Seconds until a rate-limited client may retry, from `Retry-After`. */
  retryAfter?: number;
}

export interface AskState {
  status: AskStatus;
  /** The question being (or last) answered. */
  question: string | null;
  /** The answer so far; it grows while `status` is `streaming`. */
  answer: string;
  /** Numbered sources, available before the first word of the answer. */
  sources: AskSource[];
  /** True when the server found nothing relevant and answered "I don't know". */
  refused: boolean;
  /**
   * True when the answer stopped at the model's output limit (`maxOutputTokens`), so it is
   * probably incomplete even though `status` is `done`.
   */
  truncated: boolean;
  retrieval: 'hybrid' | 'keyword' | null;
  error: AskError | null;
}

export interface UseAskOptions {
  /** The handler's URL. Default `/api/ask`. */
  endpoint?: string;
  /** Extra request headers, e.g. an auth token. */
  headers?: Record<string, string>;
  /** Custom fetch, e.g. for tests or instrumentation. */
  fetch?: typeof fetch;
  /** Called once an answer completes or fails. */
  onFinish?: (state: AskState) => void;
}

export interface UseAsk extends AskState {
  /** Asks a question, aborting any answer in flight. */
  ask: (question: string) => Promise<void>;
  /** Stops the current answer, keeping what has streamed so far. */
  stop: () => void;
  /** Back to idle. */
  reset: () => void;
}

const INITIAL: AskState = {
  status: 'idle',
  question: null,
  answer: '',
  sources: [],
  refused: false,
  truncated: false,
  retrieval: null,
  error: null,
};

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: unknown } | null)?.name === 'AbortError';

async function errorFrom(response: Response, endpoint: string): Promise<AskError> {
  let message =
    response.status === 404
      ? 'Answers aren’t available here right now.'
      : `Something went wrong (${String(response.status)}). Please try again.`;
  try {
    const body = (await response.json()) as Partial<AskErrorBody>;
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON; keep the generic message.
  }
  if (response.status === 404 && isDevelopment()) {
    const url = typeof location === 'undefined' ? endpoint : new URL(endpoint, location.href).href;
    console.warn(
      `[ask-my-site] POST ${url} returned 404: no ask endpoint answers there. While you ` +
        'develop, run `npx ask-my-site dev` and point the dialog’s `endpoint` at ' +
        'http://localhost:8787/api/ask; to deploy one, see https://github.com/dgesteves/ask-my-site#readme.',
    );
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      kind: 'rate-limited',
      message,
      status: 429,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    };
  }
  return { kind: 'http', message, status: response.status };
}

/** A development build (as the bundler defines `NODE_ENV`), or a page served from this machine. */
function isDevelopment(): boolean {
  let env: string | undefined;
  try {
    env = process.env.NODE_ENV;
  } catch {
    // No bundler defined it, and there is no `process` in a browser.
  }
  return (env !== undefined && env !== 'production') || isLocalPage();
}

const isLocalPage = (): boolean =>
  typeof location !== 'undefined' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/** Coalesces text deltas into at most one state update per animation frame. */
function frameScheduler(): { schedule: (fn: () => void) => void; flush: () => void } {
  let pending: (() => void) | null = null;
  let handle: number | ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    handle = null;
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    schedule: (fn) => {
      pending = fn;
      if (handle !== null) return;
      handle =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(run)
          : setTimeout(run, 16);
    },
    flush: () => {
      if (handle !== null) {
        if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') {
          cancelAnimationFrame(handle);
        } else {
          clearTimeout(handle);
        }
      }
      run();
    },
  };
}

/**
 * Asks questions of an ask-my-site handler and exposes the streaming answer as state.
 *
 * ```tsx
 * const { ask, answer, sources, status } = useAsk();
 * ```
 *
 * Sources arrive before the answer, so citations are clickable as soon as they appear. Text
 * deltas are batched to one render per animation frame.
 */
export function useAsk(options: UseAskOptions = {}): UseAsk {
  const [state, setState] = useState<AskState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  // The in-flight answer, ahead of state by up to one animation frame; stop() keeps all of it.
  const liveAnswerRef = useRef('');
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  const ask = useCallback(async (input: string): Promise<void> => {
    const question = input.trim();
    if (!question) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    liveAnswerRef.current = '';
    const { endpoint = '/api/ask', headers, fetch: fetcher = fetch, onFinish } = optionsRef.current;

    let current: AskState = { ...INITIAL, status: 'loading', question };
    const commit = (next: Partial<AskState>): void => {
      current = { ...current, ...next };
      const snapshot = current;
      if (!controller.signal.aborted) setState(snapshot);
    };
    commit({});

    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbort(error)) return;
      commit({
        status: 'error',
        error: { kind: 'network', message: 'Could not reach the server. Check your connection.' },
      });
      onFinish?.(current);
      return;
    }

    if (!response.ok || !response.body) {
      const error = response.ok
        ? { kind: 'stream' as const, message: 'The response had no body.' }
        : await errorFrom(response, endpoint);
      // A newer question may have started while the error body was being read.
      if (controller.signal.aborted) return;
      commit({ status: 'error', error });
      onFinish?.(current);
      return;
    }

    const frames = frameScheduler();
    let answer = '';
    let streamError: string | null = null;
    // An object, so the flags set inside the stream callback are visible to control-flow analysis.
    const progress = { finished: false, truncated: false };
    try {
      await readAskStream(response.body, {
        metadata: ({ refused, retrieval }) => {
          commit({ refused, retrieval });
        },
        source: (source) => {
          commit({ sources: [...current.sources, source] });
        },
        delta: (text) => {
          answer += text;
          if (controllerRef.current === controller) liveAnswerRef.current = answer;
          frames.schedule(() => {
            commit({ status: 'streaming', answer });
          });
        },
        error: (message) => {
          streamError = message;
        },
        finish: (finishReason) => {
          progress.finished = true;
          progress.truncated = finishReason === 'length';
        },
      });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      streamError = 'The answer was interrupted. Please try again.';
    }
    frames.flush();
    if (controller.signal.aborted) return;
    // A stream that ends without `finish` was cut off by a proxy, a timeout or a crash: an
    // incomplete answer must not look complete.
    if (streamError === null && !progress.finished) {
      streamError = 'The answer was cut off. Please try again.';
    }
    commit(
      streamError === null
        ? { status: 'done', answer, truncated: progress.truncated }
        : { status: 'error', answer, error: { kind: 'stream', message: streamError } },
    );
    onFinish?.(current);
  }, []);

  const stop = useCallback((): void => {
    controllerRef.current?.abort();
    const answer = liveAnswerRef.current;
    setState((previous) => {
      if (previous.status !== 'loading' && previous.status !== 'streaming') return previous;
      const kept = answer.length > previous.answer.length ? answer : previous.answer;
      return { ...previous, answer: kept, status: kept ? 'done' : 'idle' };
    });
  }, []);

  const reset = useCallback((): void => {
    controllerRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, ask, stop, reset };
}
