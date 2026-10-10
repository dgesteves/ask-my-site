#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';

import { main } from './main';

/** A question for the person at the terminal, when there is one. */
const prompt = process.stdin.isTTY
  ? async (question: string): Promise<string> => {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await readline.question(question);
      } finally {
        readline.close();
      }
    }
  : undefined;

process.exitCode = await main(process.argv.slice(2), {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
  cwd: process.cwd(),
  env: process.env,
  ...(prompt ? { prompt } : {}),
});
