// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AskMySiteGlobalData } from '../src/docusaurus';
import AskMySite from '../src/docusaurus/theme/AskMySite';
import { globalData } from './docusaurus-client';

beforeAll(() => {
  // jsdom lacks these; cmdk and Radix call them.
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
  const instances: Record<string, AskMySiteGlobalData> = {
    docs: { endpoint: '/api/ask', dialog: { title: 'Ask the docs', shortcut: 'j' } },
    blog: { endpoint: '/api/blog', dialog: { title: 'Ask the blog', buttonLabel: 'Ask' } },
  };
  globalData.instances = instances;
});

afterEach(() => {
  cleanup();
});

describe('@theme/AskMySite', () => {
  it('renders one launcher, with its shortcut, for the first plugin instance', async () => {
    // The plugin's Root and a swizzled Root can both render it.
    render(
      <>
        <AskMySite />
        <AskMySite />
      </>,
    );
    const launcher = await screen.findByRole('button', { name: 'Ask AI' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+J Control+J');

    await userEvent.click(launcher);
    expect(await screen.findByRole('dialog', { name: 'Ask the docs' })).toBeTruthy();
  });

  it('reads the plugin instance it is given', async () => {
    render(<AskMySite pluginId="blog" />);
    const launcher = await screen.findByRole('button', { name: 'Ask' });
    expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Meta+I Control+I');
  });
});
