import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../src';
import { isLocalHost, isLocalOrigin, startDevServer, type DevServer } from '../src/cli/dev';
import { main } from '../src/cli/main';
import { mockEmbeddingModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { corpus } from './helpers';

let root: string;
let server: DevServer | undefined;
let logs: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ondocs-dev-security-'));
  const { index } = await buildIndex({ documents: corpus, embeddingModel: mockEmbeddingModel() });
  await writeIndexFile(join(root, 'ask-index.json'), index);
  logs = [];
  server = await startDevServer({
    file: join(root, 'ask-index.json'),
    port: 0,
    env: {},
    log: (line) => logs.push(line),
    error: (line) => logs.push(line),
  });
});
afterEach(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

const port = (): number => Number(new URL(server?.endpoint ?? '').port);

/** A raw request, so the test controls the Host header as a browser after DNS rebinding sends it. */
function raw(
  headers: Record<string, string>,
  body: string | Buffer = '{"question":"int8"}',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: port(),
        path: '/api/ask',
        method: 'POST',
        // A fresh connection each time: the server closes one after refusing a body.
        agent: false,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: text });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('ondocs dev, against pages on other sites', () => {
  it('refuses a cross-site page, so it cannot spend your key', async () => {
    const response = await raw({
      host: `localhost:${String(port())}`,
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: 'forbidden', message: 'Origin https://evil.example is not allowed.' },
    });
    expect(logs.join('\n')).toContain('pass --allow-origin https://evil.example');
    // A sandboxed iframe or a file:// page sends `Origin: null`.
    expect((await raw({ host: `localhost:${String(port())}`, origin: 'null' })).status).toBe(403);
  });

  it('refuses a request for another host name: DNS rebinding makes it same-origin', async () => {
    // rebind.example resolves to 127.0.0.1, so its page posts to its own origin, and the
    // browser sends that name in Host (and Origin).
    const rebound = await raw({
      host: `rebind.example:${String(port())}`,
      origin: `http://rebind.example:${String(port())}`,
    });
    expect(rebound.status).toBe(403);
    expect(JSON.parse(rebound.body)).toMatchObject({ error: { code: 'forbidden' } });
    // Without an Origin header, too.
    expect((await raw({ host: 'rebind.example' })).status).toBe(403);
    expect(logs.join('\n')).toContain('Refused a request for host rebind.example');

    for (const host of [`localhost:${String(port())}`, `127.0.0.1:${String(port())}`]) {
      expect((await raw({ host, origin: 'http://localhost:3000' })).status).toBe(200);
    }
    // A tool on this machine, such as curl, sends no Origin.
    expect((await raw({ host: `127.0.0.1:${String(port())}` })).status).toBe(200);
  });

  it('caps the body as the handler does, while reading it', async () => {
    const host = `localhost:${String(port())}`;
    const big = JSON.stringify({ question: 'int8', padding: 'x'.repeat(70 * 1024) });
    const declared = await raw({ host }, big);
    expect(declared.status).toBe(413);
    expect(JSON.parse(declared.body)).toMatchObject({ error: { code: 'payload_too_large' } });

    // Chunked and endless: it must answer once the limit is passed, not wait for an end that
    // never comes while the body piles up in memory.
    const outcome = await new Promise<number | 'hung up'>((resolve) => {
      let done = false;
      const finish = (result: number | 'hung up'): void => {
        if (done) return;
        done = true;
        resolve(result);
        req.destroy();
      };
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: port(),
          path: '/api/ask',
          method: 'POST',
          agent: false,
          headers: { host, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          finish(res.statusCode ?? 0);
        },
      );
      // A client still writing may see the server hang up before it reads the 413; either way
      // the server stopped reading.
      req.on('error', () => {
        finish('hung up');
      });
      const pump = (): void => {
        if (done) return;
        req.write('x'.repeat(16 * 1024), () => setImmediate(pump));
      };
      pump();
    });
    expect([413, 'hung up']).toContain(outcome);
  });
});

describe('local hosts and origins', () => {
  it('knows the names only this machine answers to', () => {
    for (const host of [
      'localhost',
      'localhost:8787',
      '127.0.0.1:3000',
      '[::1]:4321',
      'docs.localhost:3000',
    ]) {
      expect([host, isLocalHost(host)]).toEqual([host, true]);
    }
    for (const host of [
      undefined,
      '',
      'evil.example',
      'localhost.evil.example',
      '127.0.0.1.nip.io',
      '10.0.0.5:8787',
    ]) {
      expect([host, isLocalHost(host)]).toEqual([host, false]);
    }
    expect(isLocalOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalOrigin('https://127.0.0.1')).toBe(true);
    expect(isLocalOrigin('http://[::1]:4321')).toBe(true);
    expect(isLocalOrigin('null')).toBe(false);
    expect(isLocalOrigin('file://')).toBe(false);
    expect(isLocalOrigin('http://localhost.evil.example')).toBe(false);
  });

  it('takes --allow-origin, keeps --origin working, and rejects what is not an origin', async () => {
    const stderr: string[] = [];
    const code = await main(['dev', '--allow-origin', 'https://docs.example.com/path'], {
      cwd: root,
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr.join('\n')).toContain('--allow-origin takes an origin');

    const stdout: string[] = [];
    const controller = new AbortController();
    const run = main(
      [
        'dev',
        '--port',
        '0',
        '--allow-origin',
        'https://docs.example.com',
        '--origin',
        'https://b.example',
      ],
      {
        cwd: root,
        env: {},
        signal: controller.signal,
        stdout: (line) => {
          stdout.push(line);
          if (line.includes('Endpoint')) controller.abort();
        },
        stderr: () => undefined,
      },
    );
    expect(await run).toBe(0);
    expect(stdout.join('\n')).toContain(
      '(CORS: localhost, https://docs.example.com, https://b.example)',
    );
  });
});
