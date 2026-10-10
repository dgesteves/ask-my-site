import type { MountAskDialogOptions } from './index';

/**
 * The `mountAskDialog` options a `<script>` tag's `data-*` attributes describe: `data-endpoint`,
 * `data-title`, `data-placeholder`, `data-suggestions` (a JSON array of strings),
 * `data-shortcut` and `data-button-label` (`"false"` turns either off), `data-theme` and
 * `data-links` (`all` or `sources`).
 */
export function scriptOptions(data: DOMStringMap): MountAskDialogOptions {
  const options: MountAskDialogOptions = {};
  if (data.endpoint) options.endpoint = data.endpoint;
  if (data.title) options.title = data.title;
  if (data.placeholder) options.placeholder = data.placeholder;
  if (data.suggestions) {
    try {
      const suggestions: unknown = JSON.parse(data.suggestions);
      if (!Array.isArray(suggestions) || !suggestions.every((s) => typeof s === 'string')) {
        throw new TypeError('not an array of strings');
      }
      options.suggestions = suggestions;
    } catch {
      console.warn(
        `[ask-my-site] data-suggestions must be a JSON array of strings, such as ["How do I install it?"]; ignoring ${data.suggestions}`,
      );
    }
  }
  if (data.shortcut !== undefined) {
    options.shortcut = data.shortcut === 'false' || data.shortcut === '' ? false : data.shortcut;
  }
  if (data.buttonLabel !== undefined) {
    options.buttonLabel =
      data.buttonLabel === 'false' || data.buttonLabel === '' ? false : data.buttonLabel;
  }
  if (data.theme === 'auto' || data.theme === 'light' || data.theme === 'dark') {
    options.theme = data.theme;
  }
  if (data.links === 'all' || data.links === 'sources') options.links = data.links;
  return options;
}
