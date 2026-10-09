'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const OPEN_EVENT = 'ask-my-site:open';

/** Opens the dialog from anywhere on the page. */
export function openAsk(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// The dialog's code (Radix, cmdk, the dialog itself) loads once the page is idle, or on the first
// ⌘K or click, so it never competes with the first paint.
const SiteAskDialog = dynamic(() => import('./ask-dialog').then((m) => m.SiteAskDialog), {
  ssr: false,
});

/** Text fields and editors keep ⌘K, as the dialog's own shortcut does. */
const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
    null;

/** The ask dialog, mounted once in the root layout and opened by ⌘K or any `AskButton`. */
export function Ask({ mode }: { mode: 'openai' | 'mock' }) {
  const [open, setOpenState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const openRef = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);

  useEffect(() => {
    const load = () => {
      setLoaded(true);
    };
    const show = () => {
      load();
      setOpen(true);
    };
    // ⌘K is handled here rather than by the dialog, so it works before the dialog has loaded.
    // As in the dialog: a text field keeps it, except the dialog's own input, which closes it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      if (!openRef.current && isEditable(event.target)) return;
      event.preventDefault();
      load();
      setOpen(!openRef.current);
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener('keydown', onKeyDown);
    const idle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(load, { timeout: 4000 })
        : window.setTimeout(load, 2000);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener('keydown', onKeyDown);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [setOpen]);

  return loaded ? <SiteAskDialog mode={mode} open={open} onOpenChange={setOpen} /> : null;
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
