import { createHighlighter, type Highlighter, type ThemeRegistration } from 'shiki';

/**
 * Code colors from the site's palette: cyan for strings and names, magenta for keywords, muted
 * for punctuation and comments. Highlighting runs at build time; the page ships plain HTML.
 */
const theme: ThemeRegistration = {
  name: 'ondocs',
  type: 'dark',
  colors: { 'editor.background': '#14181d', 'editor.foreground': '#dfe6ee' },
  tokenColors: [
    { settings: { foreground: '#dfe6ee' } },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#7c8796' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
      ],
      settings: { foreground: '#f0468a' },
    },
    {
      scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'],
      settings: { foreground: '#67e8f9' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.character'],
      settings: { foreground: '#67e8f9' },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call entity.name.function',
        'entity.name.tag',
        'support.class.component',
      ],
      settings: { foreground: '#22d3ee' },
    },
    {
      scope: ['entity.name.type', 'support.type', 'entity.other.attribute-name'],
      settings: { foreground: '#a5f3fc' },
    },
    {
      scope: ['variable.parameter', 'meta.object-literal.key', 'support.type.property-name'],
      settings: { foreground: '#f5f7fa' },
    },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: '#9aa6b4' },
    },
    // Shell: the command in white, flags muted, as they read in a terminal.
    {
      scope: ['entity.name.command', 'support.function.builtin'],
      settings: { foreground: '#f5f7fa' },
    },
    { scope: ['constant.other.option'], settings: { foreground: '#9aa6b4' } },
  ],
};

const LANGUAGES = ['ts', 'tsx', 'js', 'jsx', 'json', 'shellscript', 'toml', 'html'] as const;
const ALIASES: Partial<Record<string, string>> = {
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
};
const LABELS: Partial<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  sh: 'Terminal',
  bash: 'Terminal',
  shell: 'Terminal',
  toml: 'TOML',
  html: 'HTML',
};

let highlighter: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [theme], langs: [...LANGUAGES] });
  return highlighter;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Highlighted `<pre>` for a code block, or escaped plain text for a language it doesn't know. */
export async function highlight(code: string, lang = ''): Promise<string> {
  const language = ALIASES[lang] ?? lang;
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    return `<pre class="shiki" tabindex="0"><code>${escapeHtml(code)}</code></pre>`;
  }
  return (await getHighlighter()).codeToHtml(code, { lang: language, theme: 'ondocs' });
}

/**
 * A code block with its language and a copy button. The button works through the delegated
 * click handler in `CopyButtons`, so the block itself is static HTML.
 */
export async function codeBlock(code: string, lang = '', title?: string): Promise<string> {
  const label = title ?? LABELS[lang] ?? (lang ? lang.toUpperCase() : 'Text');
  const head = `<div class="code-head"><span class="code-label">${escapeHtml(label)}</span><button type="button" class="copy-button" data-copy aria-label="Copy code">Copy</button></div>`;
  return `<div class="code-block">${head}${await highlight(code.replace(/\n$/, ''), lang)}</div>`;
}
