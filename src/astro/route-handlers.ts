// The handlers both injected routes share, made from the integration's settings, so the ask and
// MCP endpoints hold one copy of the index between them.
import * as generated from 'virtual:ondocs/route';

import { routeHandlers, type RouteModule } from './route';

export const handlers = routeHandlers(generated as RouteModule);
