'use client';

import { AskDialog } from 'ask-my-site/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { SUGGESTIONS } from '../lib/site';

const OPEN_EVENT = 'ask-my-site:open';

/** Opens the dialog from anywhere on the page. */
export function openAsk(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The ask dialog, mounted once in the root layout and opened by ⌘K or any `AskButton`. */
export function Ask({ mode }: { mode: 'openai' | 'mock' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => {
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, []);
  return (
    <AskDialog
      endpoint="/api/ask"
      open={open}
      onOpenChange={setOpen}
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

const noSubscription = () => () => undefined;

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere; the server renders the Mac form. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noSubscription,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'),
    () => '⌘K',
  );
}

/** A button that opens the dialog, with the keyboard shortcut on devices that have a keyboard. */
export function AskButton({
  className,
  children,
  shortLabel,
}: {
  className: string;
  children: ReactNode;
  /** Shown instead of `children` on narrow screens. */
  shortLabel?: string;
}) {
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      className={className}
      onClick={openAsk}
      aria-keyshortcuts="Meta+K Control+K"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" className="spark">
        <path
          d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
          fill="currentColor"
        />
      </svg>
      {shortLabel ? (
        <>
          <span className="label-long">{children}</span>
          <span className="label-short">{shortLabel}</span>
        </>
      ) : (
        <span>{children}</span>
      )}
      <kbd className="shortcut-hint" aria-hidden="true">
        {shortcut}
      </kbd>
    </button>
  );
}
