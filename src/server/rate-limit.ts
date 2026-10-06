/**
 * Rate limiting is a hook: any `(request) => { success }` function works. Two implementations
 * ship: an in-memory token bucket and a zero-dependency adapter for `@upstash/ratelimit`.
 */

export interface RateLimitResult {
  success: boolean;
  /** Requests allowed per window. */
  limit?: number;
  /** Requests left in the current window. */
  remaining?: number;
  /** Unix time in milliseconds when the limit resets. */
  reset?: number;
}

export type RateLimiter = (request: Request) => RateLimitResult | Promise<RateLimitResult>;

/** Headers that a platform sets itself and a client cannot forge through it. */
const PLATFORM_HEADERS = ['cf-connecting-ip', 'fly-client-ip', 'x-nf-client-connection-ip'];

/**
 * The client's IP, or `"anonymous"`.
 *
 * Platform-set headers win (Cloudflare, Fly, Netlify), then `x-real-ip`, then the *last*
 * `x-forwarded-for` entry: proxies append to that header, so its first entry is whatever the
 * client sent and must never be trusted. Vercel overwrites both headers, so they are safe there.
 * Behind any other setup, pass your own `key`.
 */
export function clientKey(request: Request): string {
  for (const name of PLATFORM_HEADERS) {
    const value = request.headers.get(name)?.trim();
    if (value) return value;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded || 'anonymous';
}

export interface MemoryRateLimitOptions {
  /** Requests allowed per window. Default 10. */
  limit?: number;
  /** Window length in milliseconds. Default 60 000. */
  windowMs?: number;
  /** Maps a request to a bucket. Default {@link clientKey}. */
  key?: (request: Request) => string;
  /** Buckets kept before the least recently used are evicted. Default 10 000. */
  maxKeys?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * An in-memory token bucket per client: bursts up to `limit`, refilling continuously over
 * `windowMs`.
 *
 * State lives in one process or isolate. On serverless platforms each instance counts on its
 * own, so treat it as a guard against a single noisy client, not a global quota. Use
 * {@link upstashRateLimit} (or your own store) for a shared limit.
 */
export function memoryRateLimit(
  options: MemoryRateLimitOptions = {},
): (request: Request) => Required<RateLimitResult> {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const key = options.key ?? clientKey;
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `memoryRateLimit: limit must be a positive integer (got ${String(limit)}).`,
    );
  }
  if (!(windowMs > 0) || !Number.isFinite(windowMs)) {
    throw new RangeError(`memoryRateLimit: windowMs must be positive (got ${String(windowMs)}).`);
  }
  const refillPerMs = limit / windowMs;
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return (request) => {
    const id = key(request);
    const time = now();
    const bucket = buckets.get(id) ?? { tokens: limit, updatedAt: time };
    bucket.tokens = Math.min(limit, bucket.tokens + (time - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = time;
    const success = bucket.tokens >= 1;
    if (success) bucket.tokens -= 1;

    // Re-inserting keeps the map in least-recently-used order, so eviction drops idle clients.
    buckets.delete(id);
    buckets.set(id, bucket);
    if (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }

    const msUntilNextToken = success ? 0 : (1 - bucket.tokens) / refillPerMs;
    return {
      success,
      limit,
      remaining: Math.floor(bucket.tokens),
      reset: Math.ceil(time + (success ? (limit - bucket.tokens) / refillPerMs : msUntilNextToken)),
    };
  };
}

/** The part of `@upstash/ratelimit`'s `Ratelimit` this adapter uses. */
export interface UpstashRatelimitLike {
  limit(identifier: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    pending?: Promise<unknown>;
  }>;
}

export interface UpstashRateLimitOptions {
  key?: (request: Request) => string;
  /**
   * Keeps the runtime alive for Upstash's background analytics write, e.g. Vercel's `waitUntil`
   * from `@vercel/functions` or Cloudflare's `ctx.waitUntil`.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Adapts an `@upstash/ratelimit` instance, giving a limit shared by every instance of your app.
 * ask-my-site does not depend on Upstash; you pass in the instance you configured.
 *
 * ```ts
 * const ratelimit = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(10, '60 s') });
 * createAskHandler({ ..., rateLimit: upstashRateLimit(ratelimit) });
 * ```
 */
export function upstashRateLimit(
  ratelimit: UpstashRatelimitLike,
  options: UpstashRateLimitOptions = {},
): RateLimiter {
  const key = options.key ?? clientKey;
  return async (request) => {
    const result = await ratelimit.limit(key(request));
    if (result.pending) options.waitUntil?.(result.pending);
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  };
}
