import { computed } from 'vue';
import { useSettingsStore } from 'src/stores/settings';

export function useCurrency() {
  const settingsStore = useSettingsStore();
  const symbol = computed(() => settingsStore.values.currency_symbol || 'M');

  function format(amount) {
    return `${symbol.value} ${Number(amount || 0).toFixed(2)}`;
  }

  return { symbol, format };
}
