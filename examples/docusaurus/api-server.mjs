// A local ask endpoint for this example: `pnpm api` serves POST /api/ask on port 8787, answering
// from build/ask-index.json. Build the site with ASK_ENDPOINT=http://localhost:8787/api/ask so the
// dialog calls it. In production the same createAskHandler runs as a serverless function instead
// (see the README).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { createAskHandler } from 'ask-my-site/server';
import { mockEmbeddingModel, mockLanguageModel } from 'ask-my-site/mock';

const port = Number(process.env.PORT ?? 8787);
const origin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

const handler = createAskHandler({
  index: () => readFile(new URL('./build/ask-index.json', import.meta.url), 'utf8'),
  // Same models as the build: the offline mock unless OPENAI_API_KEY is set.
  ...(process.env.OPENAI_API_KEY
    ? await (async () => {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const openai = createOpenAI();
        return {
          model: openai('gpt-5.4-mini'),
          embeddingModel: openai.embedding('text-embedding-3-small'),
        };
      })()
    : { model: mockLanguageModel(), embeddingModel: mockEmbeddingModel() }),
  siteName: 'the ask-my-site docs',
  headers: {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
  },
});

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(new URL(req.url ?? '/', `http://localhost:${String(port)}`), {
    method: req.method,
    headers: req.headers,
    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}).listen(port, () => {
  console.log(`ask endpoint on http://localhost:${String(port)}/api/ask (CORS: ${origin})`);
});
