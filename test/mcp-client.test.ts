// The official MCP TypeScript client (v2, the SDK Claude Code's newer runtime is built on) against
// the endpoint, offline: its `fetch` calls the handler directly. Its schemas check every response,
// in each way clients connect today: the 2025 `initialize` handshake (Cursor, VS Code, older
// clients), `auto`, which tries 2026-07-28's `server/discover` first, and 2026-07-28 pinned.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { buildIndex } from '../src';
import { createMcpHandler } from '../src/server';
import { corpus } from './helpers';

const { index } = await buildIndex({ documents: corpus });

const MODES = [
  ['the 2025 handshake (initialize)', 'legacy', '2025-11-25'],
  ['auto, trying server/discover first', 'auto', '2026-07-28'],
  ['2026-07-28, pinned', { pin: '2026-07-28' }, '2026-07-28'],
] as const;

describe.each(MODES)('the official MCP client, %s', (_, mode, negotiated) => {
  it('connects, lists the tools, searches and fetches', async () => {
    const handler = createMcpHandler({ index, siteName: 'the Acme docs', rateLimit: false });
    const methods: string[] = [];
    const transport = new StreamableHTTPClientTransport(
      new URL('https://docs.example.com/api/mcp'),
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          methods.push(`${request.method} ${request.headers.get('mcp-method') ?? ''}`.trim());
          return handler(request);
        },
      },
    );
    const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode } });
    await client.connect(transport);
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe(negotiated);
      expect(client.getServerVersion()).toMatchObject({
        name: 'ondocs',
        title: 'Search the Acme docs',
      });
      expect(client.getInstructions()).toMatch(/search .* then fetch/);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
        ['search', true],
        ['fetch', true],
        ['list_pages', true],
      ]);

      const search = await client.callTool({
        name: 'search',
        arguments: { query: 'token bucket' },
      });
      const { results } = search.structuredContent as { results: { id: string; url: string }[] };
      expect(results[0]?.url).toBe('https://docs.example.com/docs/rate-limits#in-memory');

      const page = await client.callTool({
        name: 'fetch',
        arguments: { id: results[0]?.id ?? '' },
      });
      expect((page.structuredContent as { text: string }).text).toContain(
        'token bucket per client IP',
      );

      const missing = await client.callTool({ name: 'fetch', arguments: { id: '/nope' } });
      expect(missing.isError).toBe(true);
    } finally {
      await client.close();
    }
    if (negotiated === '2026-07-28') {
      expect(methods).toContain('POST server/discover');
      expect(methods.some((method) => method.startsWith('GET'))).toBe(false);
    } else {
      expect(methods[0]).toBe('POST');
    }
  });
});
