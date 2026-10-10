// An index fetched over HTTP, such as the live site's /ask-index.json, and fetched again when the
// site is redeployed. Web APIs only, so it runs in a Worker beside a static site.
import { loadIndex, type LoadedIndex } from '../search/retrieve';

/** Marks a source the handlers ask for the index on every request, as it can change. */
export const LIVE_INDEX = Symbol.for('ondocs.liveIndex');

export interface RemoteIndexOptions {
  /**
   * How long a fetched index is used before it is checked again, in seconds. The check is a
   * conditional request (`If-None-Match`, `If-Modified-Since`): a `304` keeps the index in memory,
   * and only a changed file is downloaded and loaded again. Default 300.
   */
  revalidateSeconds?: number;
  /**
   * The `fetch` to use: on Cloudflare, `env.ASSETS.fetch` reads the site's own static files
   * without leaving the Worker. Default: the global `fetch`.
   */
  fetch?: (request: Request) => Promise<Response>;
  /** Extra request headers, such as a token for a protected preview deployment. */
  headers?: Record<string, string>;
  /** Clock, for tests. */
  now?: () => number;
}

/** What {@link remoteIndex} returns: pass it as `index` to `createAskHandler` or `createMcpHandler`. */
export interface RemoteIndex {
  (): Promise<LoadedIndex>;
  readonly [LIVE_INDEX]: true;
  /** The URL it fetches. */
  readonly url: string;
}

interface Fetched {
  index: LoadedIndex;
  etag: string | null;
  lastModified: string | null;
  checkedAt: number;
}

/**
 * The index at `url`, fetched on first use and kept in memory, then checked again at most every
 * `revalidateSeconds`, so an endpoint that is deployed apart from the site, such as a Cloudflare
 * Worker answering for a GitHub Pages site, follows the site's deploys:
 *
 * ```ts
 * const index = remoteIndex('https://acme.github.io/docs/ask-index.json');
 * export default { fetch: createAskHandler({ index, model }) };
 * ```
 *
 * A check that fails (the site is down, or answers with an error) keeps the index it has and
 * tries again on the next request; only the first fetch's failure fails a request. Both handlers
 * given the same `remoteIndex` share one copy.
 */
export function remoteIndex(url: string | URL, options: RemoteIndexOptions = {}): RemoteIndex {
  const href = String(url);
  const revalidateMs = (options.revalidateSeconds ?? 300) * 1000;
  if (!Number.isFinite(revalidateMs) || revalidateMs < 0) {
    throw new RangeError(
      `remoteIndex: revalidateSeconds must be 0 or more (got ${String(options.revalidateSeconds)}).`,
    );
  }
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? ((request: Request) => fetch(request));
  let current: Fetched | null = null;
  let pending: Promise<LoadedIndex> | null = null;

  const download = async (): Promise<LoadedIndex> => {
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (current?.etag) headers.set('if-none-match', current.etag);
    else if (current?.lastModified) headers.set('if-modified-since', current.lastModified);
    let response: Response;
    try {
      response = await fetcher(new Request(href, { headers }));
    } catch (error) {
      if (current) return keep(current);
      throw new Error(`Could not fetch the index at ${href}: ${String(error)}`, { cause: error });
    }
    if (response.status === 304 && current) {
      await response.body?.cancel();
      return keep(current);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (current) return keep(current);
      throw new Error(`Could not fetch the index at ${href}: HTTP ${String(response.status)}.`);
    }
    const text = await response.text();
    let index: LoadedIndex;
    try {
      index = loadIndex(text);
    } catch (error) {
      // A half-deployed site, say: keep answering from the index that worked.
      if (current) return keep(current);
      throw error;
    }
    current = {
      index,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      checkedAt: now(),
    };
    return index;
  };

  /** Keeps the index in hand for another `revalidateSeconds`. */
  const keep = (fetched: Fetched): LoadedIndex => {
    fetched.checkedAt = now();
    return fetched.index;
  };

  const get = (): Promise<LoadedIndex> => {
    if (current && now() - current.checkedAt < revalidateMs) return Promise.resolve(current.index);
    pending ??= download().finally(() => {
      pending = null;
    });
    return pending;
  };

  return Object.assign(get, { [LIVE_INDEX]: true as const, url: href });
}

/** Whether `source` is a {@link remoteIndex}, which the handlers call on every request. */
export function isLiveIndex(source: unknown): source is RemoteIndex {
  return typeof source === 'function' && LIVE_INDEX in source;
}
