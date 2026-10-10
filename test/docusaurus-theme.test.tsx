// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AskMySiteGlobalData } from '../src/docusaurus';
import AskMySite from '../src/docusaurus/theme/AskMySite';
import AskMySiteMcp from '../src/docusaurus/theme/AskMySiteMcp';
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
    docs: {
      endpoint: '/api/ask',
      dialog: { title: 'Ask the docs', shortcut: 'j' },
      mcp: { url: 'https://docs.acme.dev/api/mcp', name: 'acme-docs' },
    },
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

describe('@theme/AskMySiteMcp', () => {
  it('shows how to add the MCP endpoint to each client, as Infima buttons', () => {
    render(<AskMySiteMcp />);
    const cursor = screen.getByRole('link', { name: 'Add to Cursor' });
    expect(cursor.getAttribute('href')).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=acme-docs&config=/,
    );
    expect(cursor.className).toContain('button button--secondary');
    expect(screen.getByRole('link', { name: 'Add to VS Code' }).getAttribute('href')).toMatch(
      /^vscode:mcp\/install\?/,
    );
    expect(screen.getByRole('link', { name: 'Add to Claude' }).getAttribute('href')).toContain(
      'connectorUrl=https%3A%2F%2Fdocs.acme.dev%2Fapi%2Fmcp',
    );
    expect(screen.getByText(/^claude mcp add --transport http acme-docs /)).toBeTruthy();
  });

  it('renders nothing for a plugin instance without an MCP endpoint', () => {
    const { container } = render(<AskMySiteMcp pluginId="blog" />);
    expect(container.innerHTML).toBe('');
  });
});
