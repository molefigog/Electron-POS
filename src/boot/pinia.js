import { createPinia } from 'pinia';
import { boot } from 'quasar/wrappers';
import { useSettingsStore } from 'src/stores/settings';

export default boot(async ({ app }) => {
  const pinia = createPinia();
  app.use(pinia);

  const settingsStore = useSettingsStore(pinia);
  try {
    await settingsStore.fetchAll();
  } catch {
    settingsStore.applyTheme();
  }
});
