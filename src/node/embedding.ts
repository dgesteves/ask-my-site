// Embedding models named by a spec string, as the CLI's `--embedding` takes them. Node.js only.
import type { EmbeddingModel } from 'ai';

import type { EmbeddingProviderOptions } from '../build';
import { mockEmbeddingModel } from '../mock';
import { importOptional } from './optional';

/**
 * An embedding model as a string: `openai:<model>` (@ai-sdk/openai, needs `OPENAI_API_KEY`),
 * `<provider>/<model>` (AI Gateway, needs `AI_GATEWAY_API_KEY`), `mock[:<dims>]` (deterministic,
 * offline) or `none` (a keyword-only index).
 */
export type EmbeddingSpec =
  'none' | 'mock' | `mock:${number}` | `openai:${string}` | `${string}/${string}`;

/** The specs, for messages. */
const SPECS = 'openai:<model>, <provider>/<model> (AI Gateway), mock[:<dims>] or none';

/** A spec that cannot be used as given: unknown, or without its API key or provider package. */
export class EmbeddingSpecError extends Error {}

export interface EmbeddingChoice {
  /** `null`: keyword-only. */
  model: EmbeddingModel | null;
  providerOptions?: EmbeddingProviderOptions;
  /** The vector size asked for, if any. */
  dimensions?: number;
}

export interface EmbeddingSpecOptions {
  /** Vector size, for models that support it (e.g. 512). `mock:<dims>` sets its own. */
  dimensions?: number;
  /** Where `OPENAI_API_KEY` and `OPENAI_BASE_URL` are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * `check` only names the model, to compare with an index: an `openai:` spec then needs
   * neither the provider package nor a key, and its model is the bare id. Default `build`.
   */
  mode?: 'build' | 'check';
  /** How messages refer to the spec. Default `embedding "<spec>"`. */
  name?: string;
}

/** Throws an {@link EmbeddingSpecError} unless `spec` is a form {@link EmbeddingSpec} lists. */
export function checkEmbeddingSpec(spec: string, name = `embedding "${spec}"`): void {
  if (!/^(?:none|mock(?::\d+)?|openai:.+|[\w-]+\/.+)$/.test(spec)) {
    throw new EmbeddingSpecError(`Unknown ${name}. Use ${SPECS}.`);
  }
}

/** The embedding model a spec names, with the provider options its dimensions need. */
export async function embeddingFromSpec(
  spec: string,
  options: EmbeddingSpecOptions = {},
): Promise<EmbeddingChoice> {
  const {
    dimensions: dims,
    env = process.env,
    mode = 'build',
    name = `embedding "${spec}"`,
  } = options;
  checkEmbeddingSpec(spec, name);
  if (spec === 'none') return { model: null };

  const mock = /^mock(?::(\d+))?$/.exec(spec);
  if (mock) {
    const dimensions = mock[1] ? Number(mock[1]) : dims;
    const model = mockEmbeddingModel(dimensions ? { dimensions } : {});
    return { model, ...(dimensions ? { dimensions } : {}) };
  }

  const openai = /^openai:(.+)$/.exec(spec);
  if (openai?.[1]) {
    const modelId = openai[1];
    const choice = dims
      ? { providerOptions: { openai: { dimensions: dims } }, dimensions: dims }
      : {};
    // Checking compares ids only, so it needs neither the provider package nor a key.
    if (mode === 'check') return { model: modelId, ...choice };
    if (!env.OPENAI_API_KEY) throw new EmbeddingSpecError(`${name} needs OPENAI_API_KEY.`);
    let provider: typeof import('@ai-sdk/openai') | null;
    try {
      provider = await importOptional<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
    } catch (error) {
      throw new Error(`${name} could not load @ai-sdk/openai: ${String(error)}`, {
        cause: error,
      });
    }
    if (!provider) {
      throw new EmbeddingSpecError(
        `${name} needs @ai-sdk/openai, which is not installed: npm i @ai-sdk/openai`,
      );
    }
    const client = provider.createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
    });
    return { model: client.embedding(modelId), ...choice };
  }

  // A gateway model id, `<provider>/<model>`: the dimensions go to that provider.
  const provider = spec.slice(0, spec.indexOf('/'));
  return {
    model: spec,
    ...(dims ? { providerOptions: { [provider]: { dimensions: dims } }, dimensions: dims } : {}),
  };
}
