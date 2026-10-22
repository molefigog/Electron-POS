/**
 * Payment methods for POS sales, in the order they appear on screen and on the
 * end-of-day sheet. `value` is what is stored in transaction_payments.method
 * (keep in sync with PAYMENT_METHODS in src-electron/db/repositories.js).
 */
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'speedpoint', label: 'SpeedPoint' },
  { value: 'eft', label: 'EFT' },
  { value: 'ecocash', label: 'EcoCash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cheque', label: 'Cheque' },
];

export function paymentLabel(value) {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label || String(value || '');
}
