/**
 * Deliberately minimal: a shortcut fired in MainLayout.vue needs to reach
 * into whatever's currently focus-worthy inside TransactionForm.vue (focus
 * a field, open a dialog, remove the active row) without either component
 * needing to know about the other's internals. A CustomEvent on `window`
 * is enough for this - only one TransactionForm is ever mounted at a time,
 * so there's no ambiguity about who's listening.
 */
const PREFIX = 'pos:';

export function emitUiEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(PREFIX + name, { detail }));
}

/** Returns an unsubscribe function - call it in onBeforeUnmount. */
export function onUiEvent(name, handler) {
  const wrapped = (e) => handler(e.detail);
  window.addEventListener(PREFIX + name, wrapped);
  return () => window.removeEventListener(PREFIX + name, wrapped);
}
