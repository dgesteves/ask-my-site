// The dialog with its floating "Ask AI" button, and the site's color scheme: what the Docusaurus
// theme and ask-my-site/embed render. Not part of the public `ask-my-site/react` API.
import { useSyncExternalStore, type ReactNode } from 'react';

import type { AskMySiteDialogOptions, AskMySiteTheme } from '../embed/options';
import { AskDialog, type AskDialogProps } from './ask-dialog';

export interface AskWithLauncherProps extends AskMySiteDialogOptions {
  endpoint: string;
  locale?: string;
  theme: 'light' | 'dark';
  headers?: Record<string, string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigate?: AskDialogProps['onNavigate'];
}

/**
 * `AskDialog` opened by ⌘/Ctrl+I (by default) and by its floating launcher button, with the
 * `ask-my-site-launcher` class, which the integration's stylesheet places and colors.
 */
export function AskWithLauncher({
  shortcut = 'i',
  buttonLabel,
  ...props
}: AskWithLauncherProps): ReactNode {
  return (
    <AskDialog
      {...props}
      shortcut={shortcut}
      launcher={buttonLabel ?? props.labels?.launcher ?? 'Ask AI'}
    />
  );
}

const DARK = '(prefers-color-scheme: dark)';

/** The page's color scheme: `<html data-theme>` when it says light or dark, else the system's. */
function pageScheme(): 'light' | 'dark' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'light' || theme === 'dark') return theme;
  return typeof matchMedia === 'function' && matchMedia(DARK).matches ? 'dark' : 'light';
}

function subscribeToScheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = typeof matchMedia === 'function' ? matchMedia(DARK) : undefined;
  media?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onChange);
  };
}

const noSubscription = () => () => undefined;

/** The color scheme to render in: `theme` itself, or with `auto`, the page's, kept up to date. */
export function useColorScheme(theme: AskMySiteTheme = 'auto'): 'light' | 'dark' {
  const auto = theme === 'auto';
  return useSyncExternalStore(
    auto ? subscribeToScheme : noSubscription,
    () => (auto ? pageScheme() : theme),
    () => (auto ? 'light' : theme),
  );
}
