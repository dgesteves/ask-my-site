// The MCP endpoint (/api/mcp by default), injected by ondocs/astro on a site with an SSR
// adapter. See route.ts.
import { serve, type RouteContext } from './route';
import { handlers } from './route-handlers';

export const prerender = false;

export function ALL(context: RouteContext): Promise<Response> {
  return serve(handlers, 'mcp', context);
}
