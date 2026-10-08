import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import type { AskMySiteOptions } from 'ask-my-site/docusaurus';
import { mockEmbeddingModel } from 'ask-my-site/mock';
import { themes as prismThemes } from 'prism-react-renderer';

// With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this example uses
// the offline mock model so it builds anywhere. The ask endpoint must use the same model.
const askMySite: AskMySiteOptions = {
  endpoint: process.env.ASK_ENDPOINT ?? '/api/ask',
  ...(process.env.OPENAI_API_KEY ? {} : { embeddingModel: mockEmbeddingModel() }),
  dialog: {
    suggestions: ['How do I install it?', 'When does it answer "I don\'t know"?'],
  },
};

const config: Config = {
  title: 'ask-my-site',
  tagline: 'An ask box for your docs: cited answers, no vector database.',
  favicon: 'img/favicon.ico',
  url: 'https://ask-my-site-docusaurus.vercel.app',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  i18n: { defaultLocale: 'en', locales: ['en'] },
  future: { v4: true, faster: true },

  presets: [
    [
      'classic',
      {
        docs: { routeBasePath: '/', sidebarPath: './sidebars.ts' },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [['ask-my-site/docusaurus', askMySite]],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'ask-my-site',
      items: [
        { href: 'https://github.com/dgesteves/ask-my-site', label: 'GitHub', position: 'right' },
      ],
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  } satisfies Preset.ThemeConfig,
};

export default config;
