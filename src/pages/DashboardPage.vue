<template>
  <q-page class="q-pa-md">
    <div class="text-h5 q-mb-md">Dashboard</div>

    <div class="row q-col-gutter-md">
      <div class="col-3" v-for="card in cards" :key="card.label">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey">{{ card.label }}</div>
            <div class="text-h5">{{ card.value }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <q-card flat bordered class="q-mt-md" v-if="productsStore.lowStock.length">
      <q-card-section class="text-subtitle1">
        <q-icon name="warning" color="negative" class="q-mr-xs" />Low Stock Alerts
      </q-card-section>
      <q-card-section>
        <div class="row q-col-gutter-sm">
          <div class="col-12 col-sm-6" v-for="p in productsStore.lowStock" :key="p.id">
            <q-card flat bordered class="low-stock-card">
              <q-card-section class="row items-center justify-between q-py-sm q-px-md">
                <div class="text-subtitle2 text-weight-medium ellipsis q-pr-sm">{{ p.name }}</div>
                <div class="text-caption text-negative text-right">
                  {{ p.stock_qty }} left<br />
                  reorder at {{ p.reorder_level }}
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useProductsStore } from 'src/stores/products';
import { useTransactionsStore } from 'src/stores/transactions';
import { useCurrency } from 'src/composables/useCurrency';

const productsStore = useProductsStore();
const transactionsStore = useTransactionsStore();
const { format } = useCurrency();

const cards = computed(() => {
  const invoices = transactionsStore.invoices;
  const today = new Date().toDateString();
  const todayInvoices = invoices.filter((t) => new Date(t.created_at).toDateString() === today);
  const revenueToday = todayInvoices.reduce((sum, t) => sum + t.grand_total, 0);

  return [
    { label: "Today's Revenue", value: format(revenueToday) },
    { label: 'Open Quotations', value: transactionsStore.quotes.filter((q) => q.status === 'quote').length },
    { label: 'Total Products', value: productsStore.items.length },
    { label: 'Low Stock Items', value: productsStore.lowStock.length },
  ];
});

onMounted(async () => {
  await Promise.all([productsStore.fetchAll(), transactionsStore.fetchAll()]);
});
</script>

<style scoped>
.low-stock-card {
  min-height: 76px;
  border-radius: 8px;
  background: #fafafa;
}
</style>
