import starlight from '@astrojs/starlight';
import { mockEmbeddingModel } from 'ask-my-site/mock';
import askMySite from 'ask-my-site/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    starlight({
      title: 'ask-my-site',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/dgesteves/ask-my-site' },
      ],
      sidebar: [
        { label: 'Start here', items: ['', 'getting-started'] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        'limits',
        'changelog',
      ],
      plugins: [
        askMySite({
          endpoint: process.env.ASK_ENDPOINT ?? '/api/ask',
          // With OPENAI_API_KEY the plugin embeds with OpenAI (its default); without it, this
          // example uses the offline mock model so it builds anywhere. The ask endpoint must use
          // the same model.
          ...(process.env.OPENAI_API_KEY ? {} : { embeddingModel: mockEmbeddingModel() }),
          dialog: {
            suggestions: ['How do I install it?', 'When does it answer "I don\'t know"?'],
          },
        }),
      ],
    }),
  ],
});
