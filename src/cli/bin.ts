#!/usr/bin/env node
import { main } from './main';

process.exitCode = await main(process.argv.slice(2), {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
  cwd: process.cwd(),
  env: process.env,
});
