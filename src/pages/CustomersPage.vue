<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h5">Customers</div>
      <q-space />
      <q-input v-model="search" dense filled clearable placeholder="Search customers..." style="width: 260px" class="q-mr-sm" @update:model-value="load" />
      <q-btn color="primary" icon="add" label="New Customer" @click="openForm(null)" />
    </div>

    <q-table flat bordered :rows="customersStore.items" :columns="columns" row-key="id" :loading="customersStore.loading">
      <template #body-cell-actions="props">
        <q-td :props="props" class="q-gutter-x-xs">
          <q-btn dense flat round icon="edit" @click="openForm(props.row)" />
          <q-btn dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="showForm">
      <q-card style="min-width: 420px">
        <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} Customer</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="form.name" label="Name *" filled />
          <q-input v-model="form.phone" label="Phone" filled />
          <q-input v-model="form.email" label="Email" filled />
          <q-input v-model="form.address" label="Address" filled type="textarea" autogrow />
          <q-input v-model="form.tax_number" label="Tax Number" filled />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useCustomersStore } from 'src/stores/customers';

const $q = useQuasar();
const customersStore = useCustomersStore();
const search = ref('');
const showForm = ref(false);
const saving = ref(false);

const columns = [
  { name: 'name', label: 'Name', field: 'name', align: 'left', sortable: true },
  { name: 'phone', label: 'Phone', field: 'phone', align: 'left' },
  { name: 'email', label: 'Email', field: 'email', align: 'left' },
  { name: 'tax_number', label: 'Tax No.', field: 'tax_number', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
];

function emptyForm() {
  return { id: null, name: '', phone: '', email: '', address: '', tax_number: '' };
}
const form = reactive(emptyForm());

function openForm(customer) {
  Object.assign(form, customer ? { ...customer } : emptyForm());
  showForm.value = true;
}

async function save() {
  if (!form.name) {
    $q.notify({ type: 'warning', message: 'Name is required' });
    return;
  }
  saving.value = true;
  try {
    if (form.id) await customersStore.update(form.id, form);
    else await customersStore.create(form);
    showForm.value = false;
    $q.notify({ type: 'positive', message: 'Customer saved' });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    saving.value = false;
  }
}

function remove(row) {
  $q.dialog({ title: 'Delete', message: `Delete ${row.name}?`, cancel: true }).onOk(async () => {
    await customersStore.remove(row.id);
  });
}

function load() {
  customersStore.fetchAll({ search: search.value });
}

onMounted(load);
</script>
