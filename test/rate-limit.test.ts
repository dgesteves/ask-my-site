import { describe, expect, it, vi } from 'vitest';

import { clientKey, memoryRateLimit, upstashRateLimit } from '../src/server';

const from = (ip: string, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/ask', { headers: { 'x-forwarded-for': ip, ...headers } });

describe('clientKey', () => {
  it('reads the last X-Forwarded-For entry, never the client-supplied start of it', () => {
    // Proxies append, so the first entry is whatever the client sent.
    expect(clientKey(from('spoofed-123, 198.51.100.1'))).toBe('198.51.100.1');
    expect(clientKey(from('198.51.100.1'))).toBe('198.51.100.1');
    expect(clientKey(new Request('http://x'))).toBe('anonymous');
  });

  it('ignores platform headers nobody said to trust', () => {
    // On Vercel, `x-forwarded-for` is the platform's; the others pass through from the client.
    for (const header of [
      'cf-connecting-ip',
      'fly-client-ip',
      'x-nf-client-connection-ip',
      'x-real-ip',
    ]) {
      expect(clientKey(from('198.51.100.1', { [header]: 'attacker' }))).toBe('198.51.100.1');
    }
  });

  it('reads only the header the deployer trusts', () => {
    const request = from('spoofed', { 'cf-connecting-ip': '198.51.100.3', 'x-real-ip': 'spoofed' });
    expect(clientKey(request, { trustedHeader: 'cf-connecting-ip' })).toBe('198.51.100.3');
    expect(clientKey(request, { trustedHeader: 'CF-Connecting-IP' })).toBe('198.51.100.3');
    // A proxy that appends to its own header: the last entry is the one it added.
    const appended = new Request('http://x', {
      headers: { 'x-client-ip': 'spoofed, 198.51.100.4' },
    });
    expect(clientKey(appended, { trustedHeader: 'x-client-ip' })).toBe('198.51.100.4');
    // Missing: one shared bucket, never a fallback to a header the client controls.
    expect(clientKey(from('198.51.100.5'), { trustedHeader: 'fly-client-ip' })).toBe('anonymous');
  });
});

describe('IPv6 client keys', () => {
  it('buckets an IPv6 client by its /64, which one subscriber is usually given', () => {
    const key = (ip: string) => clientKey(from(ip));
    expect(key('2001:db8:1:1::1')).toBe('2001:db8:1:1::/64');
    expect(key('2001:DB8:1:1:ffff:ffff:ffff:fffe')).toBe('2001:db8:1:1::/64');
    expect(key('2001:0db8:0001:0001:0000:0000:0000:0042')).toBe('2001:db8:1:1::/64');
    expect(key('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(key('[2001:db8:1:1::7]:443')).toBe('2001:db8:1:1::/64');
    expect(key('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(key('::1')).toBe('0:0:0:0::/64');
    expect(key('spoofed, 2001:db8:1:1::9')).toBe('2001:db8:1:1::/64');
  });

  it('keys IPv4 (mapped into IPv6, or with a port) as the IPv4 address', () => {
    const key = (ip: string) => clientKey(from(ip));
    expect(key('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(key('::ffff:c633:6407')).toBe('198.51.100.7');
    expect(key('198.51.100.7:52341')).toBe('198.51.100.7');
    // Not an address: kept as it is, so it is still one bucket.
    expect(key('2001:db8::1::2')).toBe('2001:db8::1::2');
    expect(key('unknown')).toBe('unknown');
  });

  it('limits a client rotating addresses within its /64 as one client', () => {
    const limit = memoryRateLimit({ limit: 3, windowMs: 60_000, now: () => 0 });
    const statuses = Array.from(
      { length: 5 },
      (_, i) => limit(from(`2001:db8:1:1::${i.toString(16)}`)).success,
    );
    expect(statuses).toEqual([true, true, true, false, false]);
    // The neighbouring /64 is another subscriber.
    expect(limit(from('2001:db8:1:2::1')).success).toBe(true);
  });
});

describe('rate limit keys under spoofing', () => {
  it('a client rotating headers the platform does not set stays in one bucket', () => {
    const limit = memoryRateLimit({ limit: 2, windowMs: 60_000, now: () => 0 });
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) {
      // What reaches the function on Vercel: the platform's x-forwarded-for and x-real-ip, plus
      // whatever else the client chose to send.
      const request = new Request('http://localhost/api/ask', {
        headers: {
          'x-forwarded-for': '198.51.100.1',
          'x-real-ip': '198.51.100.1',
          'cf-connecting-ip': `spoof-${String(i)}`,
          'fly-client-ip': `spoof-${String(i)}`,
          'x-nf-client-connection-ip': `spoof-${String(i)}`,
        },
      });
      if (limit(request).success) allowed += 1;
    }
    expect(allowed).toBe(2);
  });

  it('keys on the trusted header, so a forged X-Forwarded-For changes nothing', () => {
    const limit = memoryRateLimit({ limit: 2, trustedHeader: 'cf-connecting-ip', now: () => 0 });
    const results = Array.from(
      { length: 5 },
      (_, i) => limit(from(`spoof-${String(i)}`, { 'cf-connecting-ip': '198.51.100.9' })).success,
    );
    expect(results).toEqual([true, true, false, false, false]);
    // A custom key wins over the header.
    const perUser = memoryRateLimit({
      limit: 1,
      trustedHeader: 'cf-connecting-ip',
      key: (request) => request.headers.get('authorization') ?? 'anonymous',
      now: () => 0,
    });
    expect(perUser(from('a', { authorization: 'user-1' })).success).toBe(true);
    expect(perUser(from('a', { authorization: 'user-2' })).success).toBe(true);
    expect(perUser(from('b', { authorization: 'user-1' })).success).toBe(false);
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

describe('memoryRateLimit options', () => {
  it('rejects limits and windows that cannot work', () => {
    expect(() => memoryRateLimit({ limit: 0 })).toThrow(RangeError);
    expect(() => memoryRateLimit({ windowMs: 0 })).toThrow(RangeError);
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

  it('keys on the trusted header', async () => {
    const ratelimit = {
      limit: vi.fn(() => Promise.resolve({ success: true, limit: 10, remaining: 9, reset: 0 })),
    };
    const limiter = upstashRateLimit(ratelimit, { trustedHeader: 'fly-client-ip' });
    await limiter(from('spoofed', { 'fly-client-ip': '203.0.113.10' }));
    expect(ratelimit.limit).toHaveBeenCalledWith('203.0.113.10');
  });
});
