import { streamText } from 'ai';
import { describe, expect, it } from 'vitest';

import { extractiveAnswer, mockLanguageModel } from '../src/mock';
import { formatPrompt, type PromptSource } from '../src/server';

/** Sources numbered in the order given, as `buildSources` numbers retrieval hits. */
function sources(...pages: [title: string, heading: string, text: string][]): PromptSource[] {
  return pages.map(([title, heading, text], i) => ({
    id: i + 1,
    url: `/docs/${String(i + 1)}`,
    title,
    heading,
    text,
  }));
}

const answer = (question: string, given: PromptSource[]): string =>
  extractiveAnswer(formatPrompt(question, given));

/** The answer without citations, split into its sentences and quoted blocks. */
const quotedParts = (text: string): string[] =>
  text
    .replace(/ ?\[\d+\]/g, '')
    .split(/\n\n|(?<=[.:])\s+(?=[A-Z`*"])/)
    .map((part) => part.trim().replace(/[.:]$/, ''))
    .filter(Boolean);

const DEPLOYING: PromptSource[] = sources(
  [
    'Script tag',
    'Deploy the endpoint',
    'Deploy the endpoint next to the site with one of the recipes: a Vercel function, a Netlify function or a Cloudflare Pages function.',
  ],
  [
    'Limits',
    'Freshness',
    'The index is rebuilt when you deploy, so content that changes between deploys is not a fit.',
  ],
  [
    'Deploying',
    'Deploy to Netlify',
    'To ship it there, add a function at `netlify/functions/ask.mts`:\n\n```ts\nexport default createAskHandler({ index, model });\n```\n\nInclude the index in the bundle with `netlify.toml`.',
  ],
);

describe('extractiveAnswer', () => {
  it('says so when the prompt has no sources', () => {
    expect(extractiveAnswer('no sources here')).toBe("I don't know. No sources were provided.");
  });

  it('answers from the section whose heading matches, over passing mentions', () => {
    const text = answer('How do I deploy to Netlify?', DEPLOYING);
    expect(
      text.startsWith('To ship it there, add a function at `netlify/functions/ask.mts`:'),
    ).toBe(true);
    expect(text).toContain('[3]');
    expect(text).not.toContain('[2]');
  });

  it('quotes the code block a sentence introduces, after its citation', () => {
    const text = answer('How do I deploy to Netlify?', DEPLOYING);
    expect(text).toContain(
      '`netlify/functions/ask.mts`: [3]\n\n```ts\nexport default createAskHandler({ index, model });\n```',
    );
  });

  it('closes a code block that the chunk cut off', () => {
    const text = answer(
      'How do I configure the plugin?',
      sources([
        'Docusaurus',
        'Configure the plugin',
        'To configure the plugin, add it to `docusaurus.config.ts`:\n\n```ts\nexport default {\n  plugins: [],',
      ]),
    );
    expect(text.endsWith('  plugins: [],\n```')).toBe(true);
  });

  it('prefers the sentence that matches more of the question', () => {
    const text = answer(
      'Does the index work with Bun?',
      sources(
        ['Index', '', 'The index is a file. The index loads once. The index is small and fast.'],
        ['Runtimes', '', 'The handler runs on Node.js, Bun and Deno without changes to the index.'],
      ),
    );
    expect(text).toBe(
      'The handler runs on Node.js, Bun and Deno without changes to the index. [2]',
    );
  });

  it('answers a "what is" question with the sentence that defines it', () => {
    const text = answer(
      'What is ask-my-site?',
      sources(
        ['Demo', '', 'This site uses ask-my-site to answer questions about ask-my-site.'],
        ['FAQ', 'Why', 'ask-my-site is a self-hosted ask box for documentation sites.'],
      ),
    );
    expect(text).toBe('ask-my-site is a self-hosted ask box for documentation sites. [2]');
  });

  it('quotes a list after the sentence that introduces it, and each item only once', () => {
    const text = answer(
      'How do I exclude pages?',
      sources([
        'Indexing',
        'Excluding pages',
        'There are three ways to exclude pages:\n\n- Frontmatter: `draft: true` leaves a page out.\n- The CLI: `--ignore` skips matching files.\n- The plugins: `exclude` leaves out a path.',
      ]),
    );
    expect(text).toBe(
      'There are three ways to exclude pages: [1]\n\n- Frontmatter: `draft: true` leaves a page out.\n- The CLI: `--ignore` skips matching files.\n- The plugins: `exclude` leaves out a path.',
    );
  });

  it('quotes a table as a list, one row per item', () => {
    const text = answer(
      'Which embedding models can I use?',
      sources([
        'Model providers',
        'Embedding models',
        'Name the embedding model with a spec:\n\n| Spec | Model | Needs |\n| --- | --- | --- |\n| `openai:<model>` | OpenAI | `OPENAI_API_KEY` |\n| `mock` | The mock embedder | nothing |',
      ]),
    );
    expect(text).toBe(
      'Name the embedding model with a spec: [1]\n\n- `openai:<model>`: OpenAI; Needs: `OPENAI_API_KEY`\n- `mock`: The mock embedder; Needs: nothing',
    );
  });

  it('leaves out table rows and the leftovers of links from prose', () => {
    const text = answer(
      'Which options does the handler take?',
      sources([
        'Handler',
        'Options',
        'The handler takes options for the index and the model. See Deploying.\n\n| Option | Default |\n| --- | --- |\n| `index` | required |',
      ]),
    );
    expect(text).toBe('The handler takes options for the index and the model. [1]');
  });

  it('never splits a sentence inside quotes or inline code', () => {
    const text = answer(
      'What does it answer when nothing matches?',
      sources([
        'Retrieval',
        'Saying no',
        'When nothing matches, it answers "I don\'t know. I couldn\'t find anything." without calling the model. Set `noAnswerMessage` to change it.',
      ]),
    );
    expect(text).toContain(
      'When nothing matches, it answers "I don\'t know. I couldn\'t find anything." without calling the model.',
    );
  });

  it('cites consecutive sentences from one source once', () => {
    const text = answer(
      'How are int8 vectors stored and loaded?',
      sources([
        'Index',
        'Vectors',
        'Vectors are stored as int8 in base64. They are loaded into one Int8Array per server instance.',
      ]),
    );
    expect(text).toBe(
      'Vectors are stored as int8 in base64. They are loaded into one Int8Array per server instance. [1]',
    );
  });

  it('only ever quotes the sources', () => {
    const given = [
      ...DEPLOYING,
      ...sources([
        'FAQ',
        'Is it free?',
        'Yes. It is free and open source under the MIT license, with no hosted service.',
      ]).map((source) => ({ ...source, id: 4 })),
    ];
    const corpus = given.map((source) => source.text.replace(/\s+/g, ' ')).join(' ');
    for (const question of [
      'How do I deploy to Netlify?',
      'Is it free?',
      'When is the index rebuilt?',
      'Which functions can I deploy?',
    ]) {
      for (const part of quotedParts(answer(question, given))) {
        expect(corpus).toContain(part.replace(/\s+/g, ' '));
      }
    }
  });

  it('stays fast on long, unbalanced sources', () => {
    const hostile = 'A "quote. B `tick. C '.repeat(20_000);
    const start = performance.now();
    answer(
      'What does the quote say?',
      sources(['Page', 'Quote', hostile], ['List', '', '- a:\n'.repeat(20_000)]),
    );
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('mockLanguageModel', () => {
  it('streams the extractive answer, code blocks and line breaks included', async () => {
    const prompt = formatPrompt('How do I deploy to Netlify?', DEPLOYING);
    const result = streamText({
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      prompt,
    });
    expect(await result.text).toBe(extractiveAnswer(prompt));
  });
});
