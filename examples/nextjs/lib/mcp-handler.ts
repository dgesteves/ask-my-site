import { createMcpHandler, memoryRateLimit } from 'ondocs/server';

import index from '../ask-index.json';
import { SITE_URL } from './site';

// The same index as the ask endpoint (the import is the same object, so it is loaded once), served
// to agents as MCP tools. No embedding model: search is keyword-only, so an agent's searches and
// reads cost this site no model call at all, embedding included. The agent brings its own model.
export const mcpHandler = createMcpHandler({
  index,
  siteName: 'the ondocs documentation',
  siteUrl: SITE_URL,
  // Agents search and read several times per task, and nothing here spends a model key, so the
  // limit is looser than the ask endpoint's: 30 tool calls a minute per client IP (last
  // X-Forwarded-For entry, which Vercel sets), per instance.
  rateLimit: memoryRateLimit({ limit: 30, windowMs: 60_000 }),
  // A ceiling for the whole site per instance and UTC day, against a fleet of IPs.
  budget: { requestsPerDay: 20_000 },
  onToolCall: ({ tool, isError, durationMs, retrieval }) => {
    console.log(
      `[mcp] ${tool}${retrieval ? ` (${retrieval})` : ''}${isError ? ' error' : ''} ${String(durationMs)}ms`,
    );
  },
});
