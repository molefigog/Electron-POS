<template>
  <q-page class="q-pa-md">
    <div class="text-h5 q-mb-md">Stock Management</div>

    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <q-input v-model="search" dense filled clearable placeholder="Search products..." />
      </q-card-section>

      <q-table flat :rows="filteredProducts" :columns="productColumns" row-key="id" :pagination="productPagination"
        @row-click="onProductRowClick">
        <template #body-cell-stock_qty="props">
          <q-td :props="props">
            <q-badge :color="props.row.stock_qty <= props.row.reorder_level ? 'negative' : 'positive'">
              {{ props.row.stock_qty }}
            </q-badge>
          </q-td>
        </template>

        <template #body-cell-action="props">
          <q-td :props="props">
            <q-btn size="sm" color="primary" label="Record" @click.stop="openMovementModal(props.row)" />
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width text-center text-grey q-pa-md">No matching products</div>
        </template>
      </q-table>
    </q-card>

    <q-card flat bordered v-if="selected">
      <q-card-section class="row items-center justify-between">
        <div class="text-subtitle1">
          {{ selected.name }} ({{ selected.sku || 'No SKU' }}) - Current Stock: {{ selected.stock_qty }}
        </div>
        <q-btn color="primary" label="Record Movement" @click="openMovementModal(selected)" />
      </q-card-section>

      <q-card-section class="text-subtitle1 q-pt-none">Movement History</q-card-section>
      <q-table flat :rows="stockStore.history" :columns="historyColumns" row-key="id"
        v-model:pagination="historyPagination" :rows-per-page-options="[8]">
        <template #body-cell-type="props">
          <q-td :props="props">
            <q-badge :color="props.row.type === 'in' ? 'positive' : props.row.type === 'out' ? 'negative' : 'orange'">
              {{ props.row.type }}
            </q-badge>
          </q-td>
        </template>

        <template #body-cell-created_at="props">
          <q-td :props="props">
            {{ new Date(props.row.created_at).toLocaleString() }}
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width text-center text-grey q-pa-md">No movements yet</div>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="movementModalOpen" persistent>
      <q-card style="min-width: 420px; max-width: 95vw;">
        <q-card-section class="text-h6">Record Stock Movement</q-card-section>

        <q-card-section class="q-pt-none">
          <div class="text-subtitle2 q-mb-md" v-if="selected">
            {{ selected.name }} - Current Stock: {{ selected.stock_qty }}
          </div>

          <div class="row q-col-gutter-sm">
            <div class="col-12 col-sm-4">
              <q-select v-model="movement.type" :options="movementTypes" label="Type" filled dense />
            </div>
            <div class="col-12 col-sm-4">
              <q-input v-model.number="movement.quantity" type="number"
                :label="movement.type === 'adjustment' ? 'Qty Delta (+/-)' : 'Quantity'" filled dense />
            </div>
            <div class="col-12 col-sm-4">
              <q-input v-model="movement.reason" label="Reason" filled dense />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="closeMovementModal" />
          <q-btn color="primary" label="Record" @click="record" :loading="recording" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useProductsStore } from 'src/stores/products';
import { useStockStore } from 'src/stores/stock';

const $q = useQuasar();
const productsStore = useProductsStore();
const stockStore = useStockStore();
const selected = ref(null);
const search = ref('');
const recording = ref(false);
const movementModalOpen = ref(false);
const movementTypes = ['in', 'out', 'adjustment'];
const movement = reactive({ type: 'in', quantity: 1, reason: '' });
const productPagination = {
  sortBy: 'name',
  descending: false,
  page: 1,
  rowsPerPage: 20,
};
const historyPagination = ref({
  sortBy: 'created_at',
  descending: true,
  page: 1,
  rowsPerPage: 8,
});

const productColumns = [
  { name: 'name', label: 'Product', field: 'name', align: 'left', sortable: true },
  { name: 'sku', label: 'SKU', field: 'sku', align: 'left', sortable: true },
  { name: 'barcode', label: 'Barcode', field: 'barcode', align: 'left', sortable: true },
  { name: 'stock_qty', label: 'Stock', field: 'stock_qty', align: 'right', sortable: true },
  { name: 'action', label: 'Action', field: 'id', align: 'right' },
];

const historyColumns = [
  { name: 'created_at', label: 'Date', field: 'created_at', align: 'left', sortable: true },
  { name: 'type', label: 'Type', field: 'type', align: 'left', sortable: true },
  { name: 'quantity', label: 'Qty', field: 'quantity', align: 'right', sortable: true },
  { name: 'reason', label: 'Reason', field: 'reason', align: 'left', sortable: true },
];

const filteredProducts = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return productsStore.items;

  return productsStore.items.filter((product) => {
    const name = product.name?.toLowerCase() || '';
    const sku = product.sku?.toLowerCase() || '';
    const barcode = product.barcode?.toLowerCase() || '';
    return name.includes(query) || sku.includes(query) || barcode.includes(query);
  });
});

async function select(product) {
  selected.value = product;
  await stockStore.fetchHistory(product.id);
}

async function onProductRowClick(_, row) {
  await select(row);
}

async function openMovementModal(product) {
  await select(product);
  movementModalOpen.value = true;
}

function closeMovementModal() {
  movementModalOpen.value = false;
  movement.type = 'in';
  movement.quantity = 1;
  movement.reason = '';
}

async function record() {
  if (!selected.value || !movement.quantity) return;
  recording.value = true;
  try {
    const updated = await stockStore.record({ productId: selected.value.id, ...movement });
    selected.value = updated;
    await stockStore.fetchHistory(selected.value.id);
    closeMovementModal();
    $q.notify({ type: 'positive', message: 'Stock updated' });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    recording.value = false;
  }
}

onMounted(() => productsStore.fetchAll());
</script>
