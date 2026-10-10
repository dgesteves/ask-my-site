// The embed's dialog: React, Radix and cmdk, loaded the first time the dialog is wanted, and
// rendered by `mountWithLoader` into its container. The button and the shortcut stay with it.
import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { useColorScheme } from '../react/launcher';
import { DialogPanel } from '../react/dialog-panel';
import type { DialogRenderOptions, DialogRenderer } from './mount';

interface OpenState {
  subscribe: (listener: () => void) => () => void;
  get: () => boolean;
  set: (open: boolean) => void;
}

function openState(initial: boolean): OpenState {
  let open = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => open,
    set: (next) => {
      open = next;
      for (const listener of listeners) listener();
    },
  };
}

function Embedded({
  state,
  theme,
  onNavigate,
  onOpenChange,
  ...props
}: Omit<DialogRenderOptions, 'open'> & { state: OpenState }): ReactNode {
  const open = useSyncExternalStore(state.subscribe, state.get, state.get);
  return (
    <DialogPanel
      {...props}
      theme={useColorScheme(theme)}
      open={open}
      onOpenChange={(next) => {
        state.set(next);
        onOpenChange(next);
      }}
      {...(onNavigate
        ? {
            onNavigate: (url, event) => {
              onNavigate(url, event.nativeEvent);
            },
          }
        : {})}
    />
  );
}

export const render: DialogRenderer['render'] = (element, options) => {
  const state = openState(options.open);
  const root = createRoot(element);
  const { open: _initial, ...rest } = options;
  root.render(<Embedded {...rest} endpoint={options.endpoint ?? '/api/ask'} state={state} />);
  return {
    setOpen: (open) => {
      if (state.get() !== open) state.set(open);
    },
    unmount: () => {
      root.unmount();
      element.remove();
    },
  };
};
