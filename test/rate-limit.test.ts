import { describe, expect, it, vi } from 'vitest';

import { clientKey, memoryRateLimit, upstashRateLimit } from '../src/server';

const from = (ip: string, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/ask', { headers: { 'x-forwarded-for': ip, ...headers } });

describe('clientKey', () => {
  it('reads the first forwarded address, then other proxy headers', () => {
    expect(clientKey(from('198.51.100.1, 10.0.0.1'))).toBe('198.51.100.1');
    expect(clientKey(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } }))).toBe(
      '198.51.100.2',
    );
    expect(
      clientKey(new Request('http://x', { headers: { 'cf-connecting-ip': '198.51.100.3' } })),
    ).toBe('198.51.100.3');
    expect(clientKey(new Request('http://x'))).toBe('anonymous');
  });
});

describe('memoryRateLimit', () => {
  it('allows a burst up to the limit, then refills over the window', () => {
    let now = 0;
    const limit = memoryRateLimit({ limit: 3, windowMs: 3000, now: () => now });

    expect([1, 2, 3].map(() => limit(from('a')))).toMatchObject([
      { success: true, remaining: 2 },
      { success: true, remaining: 1 },
      { success: true, remaining: 0 },
    ]);
    const blocked = limit(from('a'));
    expect(blocked.success).toBe(false);
    expect(blocked.reset).toBe(1000);

    now = 999;
    expect(limit(from('a'))).toMatchObject({ success: false });
    now = 2000;
    expect(limit(from('a'))).toMatchObject({ success: true });
  });

  it('keeps clients apart and evicts the least recently used bucket', () => {
    const limit = memoryRateLimit({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 });
    expect(limit(from('a')).success).toBe(true);
    expect(limit(from('b')).success).toBe(true);
    expect(limit(from('a')).success).toBe(false);
    // A third client evicts `b`, the least recently used; `a` keeps its empty bucket.
    expect(limit(from('c')).success).toBe(true);
    expect(limit(from('a')).success).toBe(false);
    expect(limit(from('b')).success).toBe(true);
  });
});

describe('upstashRateLimit', () => {
  it('adapts a Ratelimit instance and hands its pending work to waitUntil', async () => {
    const pending = Promise.resolve();
    const ratelimit = {
      limit: vi.fn(() =>
        Promise.resolve({ success: false, limit: 10, remaining: 0, reset: 1234, pending }),
      ),
    };
    const waitUntil = vi.fn();
    const limiter = upstashRateLimit(ratelimit, { waitUntil });

    await expect(limiter(from('203.0.113.9'))).resolves.toEqual({
      success: false,
      limit: 10,
      remaining: 0,
      reset: 1234,
    });
    expect(ratelimit.limit).toHaveBeenCalledWith('203.0.113.9');
    expect(waitUntil).toHaveBeenCalledWith(pending);
  });
});
