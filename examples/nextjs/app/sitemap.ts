import type { MetadataRoute } from 'next';

import { getDocs } from '../lib/docs';
import { SITE_URL } from '../lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await getDocs();
  return [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/docs`, changeFrequency: 'weekly', priority: 0.8 },
    ...docs.map((doc) => ({
      url: `${SITE_URL}/docs/${doc.slug}`,
      changeFrequency: 'weekly' as const,
      priority: doc.section === 'Get started' || doc.section === 'Integrations' ? 0.8 : 0.6,
    })),
  ];
}
