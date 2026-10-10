# Contributing

Issues and pull requests are welcome. For a larger change, open an issue first so we can agree on the shape before you write it.

## Setup

Node 22.12 or later (CI uses 24) and pnpm (the version in `package.json`'s `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm example:dev   # builds the package and runs the Next.js example on http://localhost:3000
```

The examples run in mock mode, so they need no key: deterministic embeddings and scripted extractive answers.

```
src/                  the package: build and search (root), cli/, node/, server/, react/, embed/,
                      docusaurus/, astro/, starlight/, loaders/, mock/
test/                 Vitest: unit, robustness (linear-time parsing), plugins, dialog with axe
examples/             nextjs (the live demo), docusaurus and starlight, built in CI
scripts/              consumer-site.mjs (fresh sites from the packed package), deploy-recipes.mjs, openai-stub.mjs, assets
bench/                retrieval and load benchmarks
```

## Checks

`pnpm validate` runs what CI runs, except the fresh-site job:

```bash
pnpm validate   # lint, format, typecheck, test, build, publint and attw, and the three example builds
```

The `consumers` CI job packs the package, scaffolds fresh Next.js, Docusaurus and Starlight sites, installs the tarball and builds each against a local OpenAI stub. To run one locally:

```bash
pnpm build && npm pack --pack-destination /tmp
node scripts/consumer-site.mjs docusaurus /tmp/ask-my-site-*.tgz /tmp/site
```

The `recipes` CI job builds what `ask-my-site init` writes for each host with that host's own tooling (`vercel build`, `netlify build --offline`, Wrangler's `--dry-run` and local `dev`), signed in to nothing, and asks it questions against the stub; the `astro-*` recipes build an Astro site with an SSR adapter and no route file. The host CLIs run with a HOME of their own, so they see no credentials. To run one locally:

```bash
pnpm build && npm pack --pack-destination /tmp
node scripts/deploy-recipes.mjs github-pages /tmp/ask-my-site-*.tgz /tmp/recipe
```

The docs live in `examples/nextjs/content/docs`, and the Docusaurus and Starlight examples' pages are generated from them: after editing a page, run `pnpm build && pnpm examples:sync` and commit the result. CI fails when they drift.

`test/corpus.test.ts` checks search on real docs: docusaurus.io's, at a pinned commit. Fetch them once with `node scripts/corpus.mjs` (a few MB, into the git-ignored `.corpus/`); without them the file is skipped locally, and CI always fetches them. A change that moves its counts has to say why.

`node scripts/js-weight.mjs --check` loads a docs page of each example in headless Chrome (build them first) and checks the JavaScript it carries before any interaction against each site's budget, and that the dialog opens from a shortcut pressed while its code loads and gives focus back when it closes. CI runs it.

Parsers must stay linear on hostile input: if you touch `src/loaders` or `src/chunk.ts`, add a case to `test/robustness.test.ts`.

## Changesets

A change to the published package needs a changeset: run `pnpm changeset`, choose patch for a fix or minor for a feature, and write a line or two for the changelog from a user's point of view. Docs, the examples and CI need none. Merging to `main` opens a release pull request, and merging that publishes to npm.

By contributing, you agree that your work is released under the [MIT license](./LICENSE) and that you follow the [code of conduct](./CODE_OF_CONDUCT.md).
