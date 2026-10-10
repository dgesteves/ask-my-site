// A stand-in for OpenAI's API, so builds that embed with `openai:` and endpoints that answer with
// `openai(…)` never reach the real one: the consumer and deploy-recipe checks in CI and the tests
// point OPENAI_BASE_URL at it.
//
// - POST /v1/embeddings answers with fixed vectors, one per input and derived from its text,
//   `dimensions` long (default 1536, as text-embedding-3-small).
// - POST /v1/responses streams a fixed answer that cites source [1], as the Responses API streams
//   one (`stream: true`), with usage.
//
// Anything else gets a 404.
//
//   node scripts/openai-stub.mjs [port]   # serves on 127.0.0.1, default port 8790
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** A unit vector that depends only on `text`: FNV-1a seeds an xorshift generator. */
function vectorFor(text, dimensions) {
  let state = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  const vector = Array.from({ length: dimensions }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff - 0.5;
  });
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

/** The answer the stub streams for every question. */
export const STUB_ANSWER = 'The stub answers from the first source [1].';

/** Streams `STUB_ANSWER` as the Responses API streams a message: one delta per word. */
function respond(res, body) {
  const id = 'msg_stub';
  const words = STUB_ANSWER.match(/\S+\s*/g) ?? [];
  const events = [
    {
      type: 'response.created',
      response: { id: 'resp_stub', created_at: 0, model: String(body.model ?? 'stub') },
    },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id } },
    ...words.map((delta) => ({
      type: 'response.output_text.delta',
      item_id: id,
      output_index: 0,
      delta,
    })),
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id } },
    {
      type: 'response.completed',
      response: { usage: { input_tokens: 100, output_tokens: words.length } },
    },
  ];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
  );
}

/**
 * Starts the stub on 127.0.0.1 (`port` 0 picks a free one). `requests` lists every request as
 * `METHOD /path`, so a caller can check the stub was the only thing called.
 *
 * @param {{ port?: number, log?: (line: string) => void }} [options]
 * @returns {Promise<{ url: string, requests: string[], close: () => Promise<void> }>}
 */
export async function startOpenAIStub({ port = 0, log } = {}) {
  /** @type {string[]} */
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const request = `${req.method ?? ''} ${req.url ?? ''}`;
      requests.push(request);
      log?.(request);
      if (req.method === 'POST' && req.url === '/v1/responses') {
        respond(res, JSON.parse(raw));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/embeddings') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `The stub does not serve ${request}.` } }));
        return;
      }
      /** @type {{ input: string | string[], model: string, dimensions?: number }} */
      const body = JSON.parse(raw);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const dimensions = body.dimensions ?? 1536;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: inputs.map((input, index) => ({
            object: 'embedding',
            index,
            embedding: vectorFor(input, dimensions),
          })),
          model: body.model,
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${String(actualPort)}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const stub = await startOpenAIStub({
    port: Number(process.argv[2] ?? 8790),
    log: (line) => console.log(line),
  });
  console.log(`OpenAI stub: OPENAI_BASE_URL=${stub.url}`);
}
