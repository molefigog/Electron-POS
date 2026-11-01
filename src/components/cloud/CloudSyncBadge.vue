<template>
  <q-btn v-if="store.available && store.supported" flat dense round :icon="icon" :color="color" to="/settings">
    <q-tooltip>{{ store.summary }}<br v-if="lastSync" />{{ lastSync }}</q-tooltip>
  </q-btn>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useCloudSyncStore } from 'src/stores/cloudSync';

const store = useCloudSyncStore();
const ICONS = { off: 'cloud_off', ok: 'cloud_done', working: 'cloud_sync', waiting: 'cloud_off', error: 'error_outline' };
const COLORS = { off: 'grey-5', ok: 'positive', working: 'primary', waiting: 'orange', error: 'negative' };
const icon = computed(() => ICONS[store.tone]);
const color = computed(() => COLORS[store.tone]);
const lastSync = computed(() => (store.status?.lastSyncAt ? `Last upload ${new Date(store.status.lastSyncAt).toLocaleTimeString()}` : ''));

onMounted(() => store.init());
</script>
