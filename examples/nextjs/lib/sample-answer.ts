import type { AskSource } from 'ask-my-site/react';
import { SOURCE_METADATA_KEY } from 'ask-my-site/server';

import { askHandler } from './ask-handler';

export interface SampleAnswer {
  question: string;
  answer: string;
  sources: AskSource[];
}

interface StreamPart {
  type: string;
  delta?: string;
  sourceId?: string;
  url?: string;
  providerMetadata?: Record<string, { title?: string; heading?: string } | undefined>;
}

/**
 * The answer `/api/ask` gives to `question`, asked once while the home page is built, so the
 * demo opens on a real answer rather than an empty box. If it fails, the demo opens empty.
 */
export async function sampleAnswer(question: string): Promise<SampleAnswer | null> {
  try {
    const response = await askHandler(
      new Request('http://localhost/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      }),
    );
    if (!response.ok) return null;
    let answer = '';
    const sources: AskSource[] = [];
    for (const line of (await response.text()).split('\n')) {
      if (!line.startsWith('data: {')) continue;
      const part = JSON.parse(line.slice(6)) as StreamPart;
      if (part.type === 'text-delta') answer += part.delta ?? '';
      if (part.type === 'source-url') {
        const meta = part.providerMetadata?.[SOURCE_METADATA_KEY];
        sources.push({
          id: Number(part.sourceId),
          url: part.url ?? '',
          title: meta?.title ?? '',
          heading: meta?.heading ?? '',
        });
      }
    }
    return answer ? { question, answer, sources } : null;
  } catch {
    return null;
  }
}
