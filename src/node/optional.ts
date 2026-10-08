// Loading an optional peer dependency, such as a provider package. Node.js only.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Loads an optional peer dependency, resolved from `from` (default: this package), or returns
 * `null` when it is not installed. Any other failure is thrown as it is: a package that is
 * installed but fails to load is not missing, and saying so hides the real error.
 *
 * It loads with Node's own `require`, which loads ES modules natively since Node.js 22.12, not
 * `import()`: Docusaurus loads plugins and its config with jiti, which rewrites `import()` into
 * its own `require` and transpiles the module, and @ai-sdk/openai does not survive that (its `z`
 * from `zod/v4` comes back undefined). `createRequire` gives the native one even there. A module
 * that `require` cannot load, one with top-level await, falls back to `import()`.
 */
export async function importOptional<T>(
  name: string,
  from: string | URL = import.meta.url,
): Promise<T | null> {
  const nativeRequire = createRequire(from);
  try {
    return nativeRequire(name) as T;
  } catch (error) {
    if (isMissing(error, name)) return null;
    const { code } = error as NodeJS.ErrnoException;
    if (code !== 'ERR_REQUIRE_ASYNC_MODULE' && code !== 'ERR_REQUIRE_ESM') throw error;
  }
  return (await import(pathToFileURL(nativeRequire.resolve(name)).href)) as T;
}

/**
 * Whether `error` says `name` itself cannot be found, as opposed to a module it imports (an
 * incomplete install of `name` is not a missing `name`).
 */
function isMissing(error: unknown, name: string): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') &&
    typeof message === 'string' &&
    // "Cannot find module 'x'" from require, "Cannot find package 'x'" from import.
    message.includes(`'${name}'`)
  );
}
