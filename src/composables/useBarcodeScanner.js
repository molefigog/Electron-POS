import { onMounted, onUnmounted } from 'vue';

/**
 * Most USB/Bluetooth barcode scanners act as a keyboard: they type the
 * code very fast then send Enter. We detect "fast typing + Enter" globally
 * so scanning works anywhere in the app without focusing a specific input,
 * while ignoring normal human typing (which is much slower between keys).
 */
export function useBarcodeScanner(onScan, { minLength = 3, maxIntervalMs = 50 } = {}) {
  let buffer = '';
  let lastTime = 0;

  function handleKeydown(e) {
    const now = Date.now();
    const isFast = now - lastTime < maxIntervalMs;
    lastTime = now;

    if (e.key === 'Enter') {
      if (buffer.length >= minLength) onScan(buffer);
      buffer = '';
      return;
    }

    if (e.key.length === 1) {
      buffer = isFast ? buffer + e.key : e.key;
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
}
