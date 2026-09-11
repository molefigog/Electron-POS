<template>
    <q-page class="q-pa-md">
        <div class="row items-center q-mb-md">
            <div class="text-h5">Suppliers</div>
            <q-space />
            <q-input v-model="search" dense filled clearable placeholder="Search suppliers..." class="q-mr-sm"
                @update:model-value="load" />
            <q-btn color="primary" icon="add" label="New Supplier" @click="openForm(null)" />
        </div>
        <q-table flat bordered :rows="suppliersStore.items" :columns="columns" row-key="id"
            :loading="suppliersStore.loading">
            <template #body-cell-actions="props">
                <q-td :props="props"><q-btn dense flat round icon="edit" @click="openForm(props.row)" /><q-btn dense
                        flat round icon="delete" color="negative" @click="remove(props.row)" /></q-td>
            </template>
        </q-table>
        <q-dialog v-model="showForm">
            <q-card style="min-width: 420px">
                <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} Supplier</q-card-section>
                <q-card-section class="q-gutter-sm">
                    <q-input v-model="form.name" label="Name *" filled autofocus />
                    <q-input v-model="form.phone" label="Phone" filled /><q-input v-model="form.email" label="Email"
                        filled />
                    <q-input v-model="form.address" label="Address" filled type="textarea" autogrow />
                    <q-input v-model="form.tax_number" label="Tax Number" filled /><q-input v-model="form.payment_terms"
                        label="Payment Terms" filled hint="e.g. Cash, 30 days" />
                </q-card-section>
                <q-card-actions align="right"><q-btn flat label="Cancel" v-close-popup /><q-btn color="primary"
                        label="Save" :loading="saving" @click="save" /></q-card-actions>
            </q-card>
        </q-dialog>
    </q-page>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useSuppliersStore } from 'src/stores/suppliers';

const $q = useQuasar();
const suppliersStore = useSuppliersStore();
const search = ref(''); const showForm = ref(false); const saving = ref(false);
const columns = [
    { name: 'name', label: 'Name', field: 'name', align: 'left', sortable: true },
    { name: 'phone', label: 'Phone', field: 'phone', align: 'left' },
    { name: 'email', label: 'Email', field: 'email', align: 'left' },
    { name: 'payment_terms', label: 'Payment Terms', field: 'payment_terms', align: 'left' },
    { name: 'actions', label: '', field: 'actions', align: 'right' },
];
function emptyForm() { return { id: null, name: '', phone: '', email: '', address: '', tax_number: '', payment_terms: '' }; }
const form = reactive(emptyForm());
function openForm(supplier) { Object.assign(form, supplier ? { ...supplier } : emptyForm()); showForm.value = true; }
async function save() {
    if (!form.name.trim()) { $q.notify({ type: 'warning', message: 'Name is required' }); return; }
    saving.value = true;
    try { if (form.id) await suppliersStore.update(form.id, form); else await suppliersStore.create(form); showForm.value = false; $q.notify({ type: 'positive', message: 'Supplier saved' }); }
    catch (err) { $q.notify({ type: 'negative', message: err.message }); }
    finally { saving.value = false; }
}
function remove(row) { $q.dialog({ title: 'Delete', message: `Delete ${row.name}?`, cancel: true }).onOk(() => suppliersStore.remove(row.id)); }
function load() { suppliersStore.fetchAll({ search: search.value }); }
onMounted(load);
</script>