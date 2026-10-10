import { mcpHandler } from '../../../lib/mcp-handler';

// MCP's Streamable HTTP transport: JSON-RPC over POST. The handler answers GET and DELETE with a
// 405, as a stateless server does, and OPTIONS for browser clients.
export const POST = mcpHandler;
export const GET = mcpHandler;
export const DELETE = mcpHandler;
export const OPTIONS = mcpHandler;
