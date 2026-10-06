/**
 * ask-my-site/server: the ask endpoint as a Web-standard request handler.
 */

export { createAskHandler } from './handler';
export type { AskFinishEvent, AskHandlerOptions, GenerationOptions, IndexSource } from './handler';
export { buildSources, defaultInstructions, formatPrompt } from './prompt';
export type { PromptSource } from './prompt';
export { clientKey, memoryRateLimit, upstashRateLimit } from './rate-limit';
export type {
  MemoryRateLimitOptions,
  RateLimiter,
  RateLimitResult,
  UpstashRateLimitOptions,
  UpstashRatelimitLike,
} from './rate-limit';
export { SOURCE_METADATA_KEY } from '../protocol';
export type { AskErrorBody, AskMetadata, AskRequestBody, AskSource } from '../protocol';
