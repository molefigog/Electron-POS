<template>
  <div>
    <div class="row items-center q-mb-sm q-gutter-sm">
      <div class="text-subtitle1">Chart of accounts</div>
      <q-space />
      <ExportMenu :table="exportTable" file-name="chart-of-accounts" :disable="!rows.length" />
      <q-btn outline no-caps icon="sync" label="Rebuild from sales" @click="rebuild">
        <q-tooltip>Re-post every invoice and customer payment from the source records</q-tooltip>
      </q-btn>
      <q-btn color="primary" no-caps icon="add" label="New account" @click="openForm(null)" />
    </div>

    <q-table flat bordered dense :rows="rows" :columns="columns" row-key="id" :loading="loading" :pagination="{ rowsPerPage: 30 }">
      <template #body-cell-is_active="props">
        <q-td :props="props">
          <q-toggle :model-value="!!props.row.is_active" dense :disable="!!props.row.is_system" @update:model-value="(v) => setActive(props.row, v)" />
        </q-td>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn dense flat round icon="edit" @click="openForm(props.row)" />
          <q-btn v-if="!props.row.is_system" dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="showForm">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} account</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="form.code" label="Code *" filled autofocus />
          <q-input v-model="form.name" label="Name *" filled />
          <q-select v-model="form.type" :options="TYPES" emit-value map-options label="Type *" filled :disable="!!form.id" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import { useCurrency } from 'src/composables/useCurrency';
import { useSettingsStore } from 'src/stores/settings';
import { useAccountingUi } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const TYPES = [
  { label: 'Asset', value: 'asset' }, { label: 'Liability', value: 'liability' }, { label: 'Equity', value: 'equity' },
  { label: 'Income', value: 'income' }, { label: 'Expense', value: 'expense' },
];

const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { ok, fail, confirm } = useAccountingUi();
const rows = ref([]);
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const form = ref({});

const columns = [
  { name: 'code', label: 'Code', field: 'code', align: 'left', sortable: true },
  { name: 'name', label: 'Account', field: 'name', align: 'left', sortable: true },
  { name: 'type', label: 'Type', field: 'type', align: 'left', sortable: true },
  { name: 'balance', label: 'Balance', field: (r) => format(r.balance), align: 'right' },
  { name: 'is_active', label: 'Active', field: 'is_active', align: 'center' },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];

const exportTable = () => ({
  title: 'Chart of Accounts',
  columns: [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'type', label: 'Type' },
    { key: 'active', label: 'Active' }, { key: 'balance', label: 'Balance', type: 'money' },
  ],
  rows: rows.value.map((r) => ({ code: r.code, name: r.name, type: r.type, active: r.is_active ? 'Yes' : 'No', balance: r.balance })),
  meta: { company: settingsStore.values.company_name || '' },
});

async function load() {
  loading.value = true;
  try {
    rows.value = await AccountingRepository.accounts();
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

function openForm(row) {
  form.value = row ? { id: row.id, code: row.code, name: row.name, type: row.type } : { id: null, code: '', name: '', type: 'expense' };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    const { id, ...data } = form.value;
    if (id) await AccountingRepository.updateAccount(id, data);
    else await AccountingRepository.createAccount(data);
    showForm.value = false;
    ok('Account saved');
    await load();
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function setActive(row, value) {
  try {
    await AccountingRepository.updateAccount(row.id, { isActive: value });
    await load();
  } catch (err) {
    fail(err);
  }
}

async function remove(row) {
  if (!(await confirm(`Delete account ${row.code} ${row.name}?`))) return;
  try {
    await AccountingRepository.deleteAccount(row.id);
    ok('Account deleted');
    await load();
  } catch (err) {
    fail(err);
  }
}

async function rebuild() {
  if (!(await confirm('Re-post every invoice and customer payment from the source records? Manual entries, expenses and bills are not touched.'))) return;
  try {
    const res = await AccountingRepository.rebuild();
    ok(`Rebuilt ${res.rebuilt} invoice(s)`);
    await load();
  } catch (err) {
    fail(err);
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.fetchAll();
  await load();
});
</script>
