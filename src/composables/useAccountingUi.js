import { useQuasar } from 'quasar';

/** Local-calendar 'YYYY-MM-DD' (toISOString() would give the UTC day, which is wrong late at night). */
export function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function monthStartISO(date = new Date()) {
  return localISO(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Electron prefixes IPC errors with "Error invoking remote method ..."; show only the real message. */
export function cleanError(err) {
  return String(err?.message || err || 'Something went wrong').replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
}

export function useAccountingUi() {
  const $q = useQuasar();
  const ok = (message) => $q.notify({ type: 'positive', message });
  const fail = (err) => $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
  function confirm(message, title = 'Please confirm') {
    return new Promise((resolve) => {
      $q.dialog({ title, message, cancel: true, persistent: true })
        .onOk(() => resolve(true))
        .onCancel(() => resolve(false))
        .onDismiss(() => resolve(false));
    });
  }
  return { $q, ok, fail, confirm };
}
