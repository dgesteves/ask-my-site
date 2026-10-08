'use client';

import { AskDialog } from 'ask-my-site/react';
import { useRouter } from 'next/navigation';

// Each one is checked against the mock model: it must get a correct, cited answer.
const SUGGESTIONS = [
  'How do I add it to Docusaurus?',
  'Do I need a vector database?',
  'Can I use Anthropic models?',
  'How much does it cost to run?',
];

export function Ask({ mode }: { mode: 'openai' | 'mock' }) {
  const router = useRouter();
  return (
    <AskDialog
      endpoint="/api/ask"
      theme="dark"
      title="Ask the ask-my-site docs"
      placeholder="Ask the docs a question…"
      suggestions={SUGGESTIONS}
      trigger={
        <button type="button" className="ask-trigger">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
              fill="currentColor"
            />
          </svg>
          <span>Ask the docs</span>
          <kbd>⌘K</kbd>
        </button>
      }
      onNavigate={(url, event) => {
        // Same-site links go through the client router; anything else navigates normally.
        if (url.startsWith('/')) {
          event.preventDefault();
          router.push(url);
        }
      }}
      footer={
        <div className="ask-footer">
          <span>
            {mode === 'mock'
              ? 'Mock mode: offline embeddings, scripted extractive answers.'
              : 'Answers are generated from these docs and can be wrong. Check the sources.'}
          </span>
          <span className="ask-footer-keys" aria-hidden="true">
            <kbd className="ask-kbd">↵</kbd> ask <kbd className="ask-kbd">esc</kbd> close
          </span>
        </div>
      }
    />
  );
}
