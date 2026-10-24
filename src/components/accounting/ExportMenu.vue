<template>
  <q-btn-dropdown outline no-caps icon="download" :label="label" :disable="disable" :loading="busy">
    <q-list dense style="min-width: 190px">
      <q-item v-for="f in formats" :key="f.value" clickable v-close-popup @click="run(f.value)">
        <q-item-section avatar><q-icon :name="f.icon" /></q-item-section>
        <q-item-section>{{ f.label }}</q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script setup>
import { ref } from 'vue';
import { useAccountingExport } from 'src/composables/useAccountingExport';

const props = defineProps({
  /** A table object, or a (async) function that returns one: { title, columns, rows, totals? } */
  table: { type: [Object, Function], default: null },
  label: { type: String, default: 'Export' },
  fileName: { type: String, default: null },
  disable: { type: Boolean, default: false },
});

const { exportTable } = useAccountingExport();
const busy = ref(false);
const formats = [
  { value: 'xlsx', label: 'Excel (.xlsx)', icon: 'table_view' },
  { value: 'csv', label: 'CSV (.csv)', icon: 'description' },
  { value: 'json', label: 'JSON (.json)', icon: 'data_object' },
];

async function run(format) {
  busy.value = true;
  try {
    await exportTable(format, props.table, props.fileName);
  } finally {
    busy.value = false;
  }
}
</script>
