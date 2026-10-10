import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { AskAnswer, citedSourceIds, safeHref, type AnswerLinks } from './answer';
import { useAsk, type AskState, type UseAskOptions } from './use-ask';

export type AskDialogSlot =
  'overlay' | 'content' | 'input' | 'list' | 'item' | 'answer' | 'sources' | 'footer';

export interface AskDialogProps extends Omit<UseAskOptions, 'onFinish'> {
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Key that opens the dialog with ⌘ (macOS) or Ctrl. Default `"k"`; `false` disables it. It does
   * not open the dialog while a text field or editor has focus.
   */
  shortcut?: string | false;
  /** Element that opens the dialog, e.g. a search button. Rendered with Radix `asChild`. */
  trigger?: ReactNode;
  /**
   * A floating "Ask AI" button in the corner of the page, as the framework plugins and the script
   * embed show, with the shortcut on it: `true`, or the button's label. Import
   * `ask-my-site/embed/launcher.css` for its look, or style `.ask-my-site-launcher` yourself.
   */
  launcher?: boolean | string;
  /** Accessible dialog title. Default `"Ask this site"`. */
  title?: string;
  placeholder?: string;
  /** Questions offered before the visitor types. */
  suggestions?: readonly string[];
  /**
   * Called when a citation or source is clicked. Call `event.preventDefault()` and route
   * yourself for client-side navigation (e.g. `router.push(url)`). The dialog closes either way.
   */
  onNavigate?: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /** `system` (default) follows `prefers-color-scheme`. */
  theme?: 'light' | 'dark' | 'system';
  /** Extra class names per part, e.g. for Tailwind. Default classes stay. */
  classNames?: Partial<Record<AskDialogSlot, string>>;
  /** Replaces the default footer. */
  footer?: ReactNode;
  /**
   * Which links in an answer stay links: `"all"` (the default) or `"sources"`, only links to the
   * pages the answer's sources are on. See `AskAnswer`.
   */
  links?: AnswerLinks;
  onFinish?: (state: AskState) => void;
}

const cx = (...names: (string | undefined | false)[]): string => names.filter(Boolean).join(' ');

function SearchIcon(): ReactNode {
  return (
    <svg className="ask-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

const noSubscription = () => () => undefined;
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Text fields, selects and rich text editors. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

function statusMessage(state: AskState): string {
  switch (state.status) {
    case 'loading':
      return 'Searching the site…';
    case 'streaming':
      return 'Writing an answer…';
    case 'done':
      if (state.refused) return 'No answer found on this site.';
      if (state.truncated) return 'Answer ready, but cut short at its length limit.';
      return `Answer ready, citing ${String(state.sources.length)} ${state.sources.length === 1 ? 'source' : 'sources'}.`;
    case 'error':
      return state.error?.message ?? 'Something went wrong.';
    case 'idle':
      return '';
  }
}

/**
 * A ⌘K "ask" palette: a Radix dialog with a cmdk input, a streaming answer with numbered
 * citations, and the list of sources.
 *
 * Accessible by construction: focus moves into the dialog on open and back to where it was on
 * close, Escape closes it, the answer region is `aria-live` (and `aria-busy` while streaming),
 * and status changes are announced through a separate `role="status"` region. Motion is
 * disabled under `prefers-reduced-motion`.
 *
 * Unstyled-friendly: every part has a stable `ask-*` class and accepts extra classes through
 * `classNames`. Import `ask-my-site/react/styles.css` for the default theme.
 */
export function AskDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  shortcut = 'k',
  trigger,
  launcher = false,
  title = 'Ask this site',
  placeholder = 'Ask a question…',
  suggestions = [],
  onNavigate,
  theme = 'system',
  classNames = {},
  footer,
  links = 'all',
  ...askOptions
}: AskDialogProps): ReactNode {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const openRef = useRef(open);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const state = useAsk(askOptions);
  const descriptionId = useId();
  // The server renders "Ctrl", and the browser corrects it after hydration.
  const mac = useSyncExternalStore(noSubscription, isMac, () => false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Closing the dialog, however it happens, cancels the answer in flight: nobody is reading it,
  // and the model would otherwise keep generating (and billing) to the end.
  const { stop } = state;
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const setOpen = useCallback(
    (next: boolean) => {
      // Controlled: the parent decides, and `openRef` follows the prop. Uncontrolled: update the
      // ref now, so two shortcut presses in one tick cannot both open.
      if (openProp === undefined) {
        openRef.current = next;
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  useEffect(() => {
    if (shortcut === false) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== shortcut.toLowerCase()) {
        return;
      }
      // In a text field the keys are often the field's own (⌘I is italic), so they are left to it.
      // The dialog's own input still closes it.
      if (!openRef.current && isEditable(event.target)) return;
      event.preventDefault();
      setOpen(!openRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcut, setOpen]);

  const submit = (question: string): void => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    void state.ask(trimmed);
  };

  const navigate = (url: string, event: MouseEvent<HTMLAnchorElement>): void => {
    onNavigate?.(url, event);
    setOpen(false);
  };

  const busy = state.status === 'loading' || state.status === 'streaming';
  const trimmedQuery = query.trim();
  const showList = state.status === 'idle' || trimmedQuery !== (state.question ?? '');
  const normalized = trimmedQuery.toLowerCase();
  const matchingSuggestions = normalized
    ? suggestions.filter((s) => s.toLowerCase().includes(normalized) && s.trim() !== trimmedQuery)
    : suggestions;
  const themeAttribute = theme === 'system' ? undefined : theme;
  const key = shortcut ? shortcut.toUpperCase() : '';

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      {launcher === false ? null : (
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="ask-my-site-launcher"
            data-ask-theme={themeAttribute}
            aria-keyshortcuts={key ? `Meta+${key} Control+${key}` : undefined}
          >
            <span aria-hidden="true">✦</span> {launcher === true ? 'Ask AI' : launcher}
            {key ? (
              <kbd aria-hidden="true">
                {mac ? '⌘' : 'Ctrl '}
                {key}
              </kbd>
            ) : null}
          </button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay
          className={cx('ask-overlay', classNames.overlay)}
          data-ask-theme={themeAttribute}
        />
        <Dialog.Content
          className={cx('ask-dialog', classNames.content)}
          data-ask-theme={themeAttribute}
          aria-describedby={descriptionId}
          onOpenAutoFocus={() => {
            // Runs before focus moves in, however the dialog was opened (shortcut, trigger,
            // controlled prop), so this is still the element to give focus back to.
            const active = document.activeElement;
            returnFocusRef.current =
              active instanceof HTMLElement && active !== document.body ? active : null;
          }}
          onCloseAutoFocus={(event) => {
            // Opened by the shortcut there is no trigger to return to, so Radix would drop focus
            // on <body>. Return it to whatever had it, without scrolling away from a citation
            // target the visitor just jumped to.
            const target = returnFocusRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
        >
          <Dialog.Title className="ask-sr-only">{title}</Dialog.Title>
          <Dialog.Description id={descriptionId} className="ask-sr-only">
            Type a question and press Enter. Answers are generated from this site’s pages and cite
            them.
          </Dialog.Description>

          <Command label={title} shouldFilter={false} loop className="ask-command">
            <div className="ask-input-row">
              <SearchIcon />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                maxLength={500}
                className={cx('ask-input', classNames.input)}
              />
              {busy ? (
                <button type="button" className="ask-stop" onClick={state.stop}>
                  Stop
                </button>
              ) : (
                <kbd className="ask-kbd">esc</kbd>
              )}
            </div>

            {/* Always mounted, as the input's aria-controls points at it. While the answer shows,
                it is hidden and empty, so Enter selects nothing. */}
            <Command.List className={cx('ask-list', classNames.list)} hidden={!showList}>
              {showList ? (
                <>
                  {trimmedQuery ? (
                    <Command.Item
                      value={`ask:${trimmedQuery}`}
                      onSelect={() => {
                        submit(trimmedQuery);
                      }}
                      className={cx('ask-item', 'ask-item-primary', classNames.item)}
                    >
                      <span className="ask-item-label">Ask</span>
                      <span className="ask-item-text">{trimmedQuery}</span>
                      <kbd className="ask-kbd">↵</kbd>
                    </Command.Item>
                  ) : null}
                  {matchingSuggestions.length > 0 ? (
                    <Command.Group heading="Suggested" className="ask-group">
                      {matchingSuggestions.map((suggestion) => (
                        <Command.Item
                          key={suggestion}
                          value={suggestion}
                          onSelect={() => {
                            submit(suggestion);
                          }}
                          className={cx('ask-item', classNames.item)}
                        >
                          <span className="ask-item-text">{suggestion}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                </>
              ) : null}
            </Command.List>
            {showList ? null : (
              <AnswerPanel
                state={state}
                onNavigate={navigate}
                classNames={classNames}
                links={links}
              />
            )}
          </Command>

          <p role="status" className="ask-sr-only">
            {statusMessage(state)}
          </p>
          {footer ?? (
            <div className={cx('ask-footer', classNames.footer)}>
              <span>Answers come from this site and can be wrong. Check the sources.</span>
              <span className="ask-footer-keys" aria-hidden="true">
                <kbd className="ask-kbd">↵</kbd> ask <kbd className="ask-kbd">esc</kbd> close
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AnswerPanel({
  state,
  onNavigate,
  classNames,
  links,
}: {
  state: ReturnType<typeof useAsk>;
  onNavigate: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  classNames: Partial<Record<AskDialogSlot, string>>;
  links: AnswerLinks;
}): ReactNode {
  const streaming = state.status === 'streaming';
  // Once the answer is complete, sources it never cites are de-emphasized.
  const cited = state.status === 'done' ? citedSourceIds(state.answer) : null;
  return (
    <div className="ask-panel">
      <div
        className={cx('ask-answer', classNames.answer)}
        aria-live="polite"
        aria-busy={state.status === 'loading' || streaming}
        data-status={state.status}
        data-refused={state.refused || undefined}
      >
        {state.status === 'loading' ? (
          <p className="ask-thinking">
            <span className="ask-spinner" aria-hidden="true" />
            Searching the site…
          </p>
        ) : (
          <AskAnswer
            text={state.answer}
            sources={state.sources}
            onNavigate={onNavigate}
            links={links}
          />
        )}
        {streaming ? <span className="ask-caret" aria-hidden="true" /> : null}
      </div>

      {state.status === 'done' && state.truncated ? (
        <p className="ask-truncated">This answer reached its length limit and may be incomplete.</p>
      ) : null}

      {state.error ? (
        <div className="ask-error" role="alert">
          <span>{state.error.message}</span>
          {state.question && state.error.kind !== 'rate-limited' ? (
            <button
              type="button"
              className="ask-retry"
              onClick={() => void state.ask(state.question ?? '')}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {state.sources.length > 0 && !state.refused ? (
        <nav aria-label="Sources" className={cx('ask-sources', classNames.sources)}>
          <h2 className="ask-sources-heading">Sources</h2>
          <ol>
            {state.sources.map((source) => {
              const href = safeHref(source.url);
              return (
                <li key={source.id}>
                  <a
                    {...(href ? { href } : {})}
                    className="ask-source"
                    data-cited={cited ? cited.has(source.id) : undefined}
                    onClick={(event) => {
                      if (href) onNavigate(href, event);
                    }}
                  >
                    <span className="ask-source-id" aria-hidden="true">
                      {source.id}
                    </span>
                    <span className="ask-source-text">
                      <span className="ask-source-title">{source.title}</span>
                      {source.heading ? (
                        <span className="ask-source-heading">{source.heading}</span>
                      ) : null}
                    </span>
                    <span className="ask-source-url">{source.url}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}
