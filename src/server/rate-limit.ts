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

export interface ClientKeyOptions {
  /**
   * The header that carries the client's IP and that your platform or proxy sets on every
   * request, replacing whatever the client sent: `cf-connecting-ip` on Cloudflare,
   * `fly-client-ip` on Fly.io, `x-nf-client-connection-ip` on Netlify. If it holds a list, the
   * last entry (the one the nearest proxy added) is used. Default `x-forwarded-for`.
   */
  trustedHeader?: string;
}

/**
 * The client's IP, read from one header, or `"anonymous"` when that header is missing. An IPv6
 * address is reduced to its /64 network (`2001:db8:1:2::/64`): one subscriber is usually given a
 * whole /64, and can use a new address from it for every request.
 *
 * By default it is the *last* `x-forwarded-for` entry: proxies append to that header, so its
 * last entry is the address the nearest proxy saw, while everything before it is whatever the
 * client sent. That is right on Vercel (which overwrites the header) and behind one proxy that
 * appends to it. Elsewhere, name the header your platform sets with `trustedHeader`; a header it
 * does not set is passed through from the client, who can then pick a new key per request.
 */
export function clientKey(request: Request, options: ClientKeyOptions = {}): string {
  const header = options.trustedHeader ?? 'x-forwarded-for';
  const address = request.headers.get(header)?.split(',').at(-1)?.trim();
  return address ? addressKey(address) : 'anonymous';
}

const IPV4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/;
const HEXTET = /^[\da-f]{1,4}$/;

/**
 * The key for one address: an IPv4 address as it is (without a port), an IPv6 address as its /64
 * (an IPv4-mapped one, `::ffff:192.0.2.1`, as the IPv4 address). Anything that parses as neither
 * is kept as it is.
 */
function addressKey(raw: string): string {
  const value = raw.toLowerCase();
  const v4 = IPV4.exec(value);
  if (v4?.[1]) return v4[1];
  // `[2001:db8::1]:443`, and a zone (`fe80::1%eth0`).
  const bare = (value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value).replace(
    /%.*$/,
    '',
  );
  const groups = ipv6Groups(bare);
  if (!groups) return value;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or `null` if it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (!address.includes(':')) return null;
  let text = address;
  // A trailing dotted quad (`::ffff:192.0.2.1`) is the last two groups.
  const quad = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (quad) {
    const bytes = quad.slice(1).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = bytes;
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): string[] => (part ? part.split(':') : []);
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill('0'), ...tail];
  if (!groups.every((group) => HEXTET.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

export interface MemoryRateLimitOptions extends ClientKeyOptions {
  /** Requests allowed per window. Default 10. */
  limit?: number;
  /** Window length in milliseconds. Default 60 000. */
  windowMs?: number;
  /** Maps a request to a bucket, replacing {@link clientKey} and `trustedHeader`. */
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
  const key = options.key ?? ((request: Request) => clientKey(request, options));
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

export interface UpstashRateLimitOptions extends ClientKeyOptions {
  /** Maps a request to an identifier, replacing {@link clientKey} and `trustedHeader`. */
  key?: (request: Request) => string;
  /**
   * Keeps the runtime alive for Upstash's background analytics write, e.g. Vercel's `waitUntil`
   * from `@vercel/functions` or Cloudflare's `ctx.waitUntil`.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Adapts an `@upstash/ratelimit` instance, giving a limit shared by every instance of your app.
 * ondocs does not depend on Upstash; you pass in the instance you configured.
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
  const key = options.key ?? ((request: Request) => clientKey(request, options));
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
