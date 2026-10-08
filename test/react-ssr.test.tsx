import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AskDialog } from '../src/react';

describe('AskDialog on the server', () => {
  it('renders its launcher without reaching for the browser', () => {
    const html = renderToString(<AskDialog launcher="Ask the docs" />);
    expect(html).toContain('class="ask-my-site-launcher"');
    expect(html).toContain('Ask the docs');
    // The platform is only known in the browser, which corrects it after hydration.
    expect(html).toContain('Ctrl <!-- -->K');
  });
});
