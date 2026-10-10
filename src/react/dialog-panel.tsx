// The dialog itself: Radix Dialog, cmdk and the answer. `AskDialog` loads this module when the
// dialog is first wanted (a hover or focus on its button, its shortcut, or opening it), so a
// page carries none of it until then.
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { AskAnswer, citedSourceIds, safeHref, type AnswerLinks } from './answer';
import type { AskDialogProps, AskDialogSlot } from './ask-dialog';
import { useAsk, type AskState } from './use-ask';

/** What `AskDialog` hands the dialog: its props, with the open state it keeps. */
export type DialogPanelProps = Omit<
  AskDialogProps,
  'open' | 'defaultOpen' | 'onOpenChange' | 'shortcut' | 'trigger' | 'launcher'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

function Thumb({ down = false }: { down?: boolean }): ReactNode {
  return (
    <svg
      className="ask-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      style={down ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        d="M7 10v11H3V10h4Zm2 11V10l4.6-7.4A1.6 1.6 0 0 1 16.5 3.6L15.6 8H20a2 2 0 0 1 2 2.3l-1.3 8.6A2.5 2.5 0 0 1 18.2 21H9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Thumbs up and down on the answer, then an optional comment, sent to the endpoint's
 * `onFeedback`. Shown only when the endpoint says it takes feedback.
 */
function Feedback({ state }: { state: ReturnType<typeof useAsk> }): ReactNode {
  const labelId = useId();
  const [comment, setComment] = useState<'closed' | 'open' | 'sent'>('closed');
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const send = async (rating: 'up' | 'down', withComment?: string): Promise<void> => {
    const ok = await state.rate(rating, withComment);
    setFailed(!ok);
    if (ok && withComment !== undefined) setComment('sent');
  };
  // Enter sends the comment, rather than reaching the command palette around it; Escape still
  // closes the dialog.
  const keepKeys = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') event.stopPropagation();
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (state.rating && text.trim()) void send(state.rating, text);
  };
  return (
    <div className="ask-feedback">
      {state.rating === null ? (
        <>
          <span id={labelId} className="ask-feedback-label">
            Was this helpful?
          </span>
          <span role="group" aria-labelledby={labelId} className="ask-feedback-buttons">
            <button
              type="button"
              className="ask-feedback-button"
              aria-label="Yes, it helped"
              onClick={() => void send('up')}
            >
              <Thumb />
            </button>
            <button
              type="button"
              className="ask-feedback-button"
              aria-label="No, it did not help"
              onClick={() => void send('down')}
            >
              <Thumb down />
            </button>
          </span>
        </>
      ) : comment === 'sent' ? (
        <span className="ask-feedback-label" role="status">
          Thanks for the comment.
        </span>
      ) : (
        <>
          <span className="ask-feedback-label" role="status">
            Thanks for the feedback.
          </span>
          {comment === 'closed' ? (
            <button
              type="button"
              className="ask-feedback-more"
              onClick={() => {
                setComment('open');
              }}
            >
              Add a comment
            </button>
          ) : (
            <form className="ask-feedback-form" onSubmit={submit} onKeyDown={keepKeys}>
              <input
                className="ask-feedback-input"
                aria-label="Comment"
                placeholder="What was missing or wrong?"
                maxLength={1000}
                value={text}
                autoFocus
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
              <button type="submit" className="ask-feedback-more">
                Send
              </button>
            </form>
          )}
        </>
      )}
      {failed ? (
        <span className="ask-feedback-error" role="alert">
          The feedback could not be sent.
        </span>
      ) : null}
    </div>
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

/** The dialog, open or closed as `open` says. Stays mounted, so its answer survives closing. */
export function DialogPanel({
  open,
  onOpenChange: setOpen,
  title = 'Ask this site',
  placeholder = 'Ask a question…',
  suggestions = [],
  onNavigate,
  theme = 'system',
  classNames = {},
  footer,
  links = 'all',
  ...askOptions
}: DialogPanelProps): ReactNode {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const state = useAsk(askOptions);
  const descriptionId = useId();

  // Closing the dialog, however it happens, cancels the answer in flight: nobody is reading it,
  // and the model would otherwise keep generating (and billing) to the end.
  const { stop } = state;
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

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

  /** Starts a new thread: the next question is asked on its own. */
  const newQuestion = (): void => {
    state.reset();
    setQuery('');
    inputRef.current?.focus();
  };

  const busy = state.status === 'loading' || state.status === 'streaming';
  const trimmedQuery = query.trim();
  const answering = state.status !== 'idle';
  const showList = !answering || trimmedQuery !== (state.question ?? '');
  // With an answer on screen, a new question follows up on it, and the suggestions are done with.
  const followingUp = answering && askOptions.followUps !== false;
  const normalized = trimmedQuery.toLowerCase();
  const matchingSuggestions = answering
    ? []
    : normalized
      ? suggestions.filter((s) => s.toLowerCase().includes(normalized) && s.trim() !== trimmedQuery)
      : suggestions;
  const themeAttribute = theme === 'system' ? undefined : theme;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
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
                ref={inputRef}
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
                      <span className="ask-item-label">{followingUp ? 'Follow up' : 'Ask'}</span>
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
            {answering ? (
              <AnswerPanel
                state={state}
                onNavigate={navigate}
                onNewQuestion={newQuestion}
                classNames={classNames}
                links={links}
              />
            ) : null}
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
  onNewQuestion,
  classNames,
  links,
}: {
  state: ReturnType<typeof useAsk>;
  onNavigate: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
  onNewQuestion: () => void;
  classNames: Partial<Record<AskDialogSlot, string>>;
  links: AnswerLinks;
}): ReactNode {
  const streaming = state.status === 'streaming';
  const settled = state.status === 'done' || state.status === 'error';
  // Once the answer is complete, sources it never cites are de-emphasized.
  const cited = state.status === 'done' ? citedSourceIds(state.answer) : null;
  const thread = state.turns.length > 0;
  return (
    <div className="ask-panel">
      {/* The thread so far: each answer with its own citations, which link to its own sources. */}
      {state.turns.map((turn, i) => (
        <div key={i} className="ask-turn">
          <p className="ask-turn-question">{turn.question}</p>
          <div className="ask-answer" data-refused={turn.refused || undefined}>
            <AskAnswer
              text={turn.answer}
              sources={turn.sources}
              onNavigate={onNavigate}
              links={links}
            />
          </div>
        </div>
      ))}
      {thread && state.question ? <p className="ask-turn-question">{state.question}</p> : null}
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

      {settled ? (
        <div className="ask-actions">
          {state.status === 'done' && state.feedbackEnabled ? (
            <Feedback key={state.id ?? state.question ?? ''} state={state} />
          ) : null}
          <button type="button" className="ask-new" onClick={onNewQuestion}>
            New question
          </button>
        </div>
      ) : null}
    </div>
  );
}
