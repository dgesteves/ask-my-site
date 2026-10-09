'use client';

import { AskDialog } from 'ask-my-site/react';
import { useRouter } from 'next/navigation';

import { SUGGESTIONS } from '../lib/site';

/** The site's dialog: the library's `AskDialog`, routing citations through the Next.js router. */
export function SiteAskDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: 'openai' | 'mock';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  return (
    <AskDialog
      endpoint="/api/ask"
      open={open}
      onOpenChange={onOpenChange}
      // The site handles ⌘K itself, so it works before this component has loaded.
      shortcut={false}
      theme="dark"
      title="Ask the ask-my-site docs"
      placeholder="Ask the docs a question…"
      suggestions={SUGGESTIONS}
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
              ? 'Mock mode: offline embeddings, answers quoted from these docs.'
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
