<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div>
        <div class="text-h5">Dashboard</div>
        <div class="text-caption text-grey-7">Financial year: {{ fiscalYearLabel }} (1 April - 31 March)</div>
      </div>
    </div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-sm-6 col-lg-3" v-for="card in cards" :key="card.label">
        <q-card flat bordered class="summary-card">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar :color="card.color" text-color="white" :icon="card.icon" size="36px" />
              <div class="q-ml-sm">
                <div class="text-caption text-grey-7">{{ card.label }}</div>
                <div class="text-h6 text-weight-bold">{{ card.value }}</div>
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <q-card flat bordered class="q-mt-md" v-if="productsStore.lowStock.length">
      <q-card-section class="row items-center">
        <div class="text-subtitle1"><q-icon name="warning" color="negative" class="q-mr-xs" />Low Stock Alerts</div>
        <q-space />
        <q-btn flat color="primary" label="See all" icon-right="arrow_forward" to="/stock" />
      </q-card-section>
      <q-card-section>
        <div class="row q-col-gutter-sm">
          <div class="col-12 col-sm-6" v-for="p in lowStockPreview" :key="p.id">
            <q-card flat bordered class="low-stock-card cursor-pointer" clickable @click="goToStock(p.id)">
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

    <q-card flat bordered class="q-mt-md stock-summary-card">
      <q-card-section class="row items-center">
        <div>
          <div class="text-subtitle1">Stock Movement This Financial Year</div>
          <div class="text-caption text-grey-7">Opening balance at {{ fiscalStartLabel }} compared with current closing
            balance</div>
        </div>
        <q-space />
        <q-btn flat color="primary" label="Open stock" icon-right="arrow_forward" to="/stock" />
      </q-card-section>
      <q-separator />
      <q-card-section class="row q-col-gutter-md">
        <div class="col-12 col-sm-4">
          <div class="text-caption text-grey-7">Opening Units</div>
          <div class="text-h6">{{ quantity(stockSummary.openingQty) }}</div>
        </div>
        <div class="col-12 col-sm-4">
          <div class="text-caption text-grey-7">Stock In</div>
          <div class="text-h6 text-positive">+{{ quantity(stockSummary.stockInQty) }}</div>
        </div>
        <div class="col-12 col-sm-4">
          <div class="text-caption text-grey-7">Stock Out</div>
          <div class="text-h6 text-negative">-{{ quantity(stockSummary.stockOutQty) }}</div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProductsStore } from 'src/stores/products';
import { useTransactionsStore } from 'src/stores/transactions';
import { useStockStore } from 'src/stores/stock';
import { useCurrency } from 'src/composables/useCurrency';

const router = useRouter();
const productsStore = useProductsStore();
const transactionsStore = useTransactionsStore();
const stockStore = useStockStore();
const { format } = useCurrency();

function dateISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const fiscalStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
const fiscalStart = new Date(fiscalStartYear, 3, 1);
const fiscalYearLabel = `${fiscalStartYear}/${String(fiscalStartYear + 1).slice(-2)}`;
const fiscalStartLabel = fiscalStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const stockSummary = computed(() => stockStore.summary || {
  openingQty: 0, closingQty: 0, stockInQty: 0, stockOutQty: 0,
  openingCostValue: 0, closingCostValue: 0, closingRetailValue: 0,
});
const lowStockPreview = computed(() => productsStore.lowStock.slice(0, 10));

function quantity(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function goToStock(productId) {
  router.push({ path: '/stock', query: { productId: String(productId) } });
}

const cards = computed(() => {
  const invoices = transactionsStore.invoices;
  const today = new Date().toDateString();
  const todayInvoices = invoices.filter((t) => new Date(t.created_at).toDateString() === today);
  const revenueToday = todayInvoices.reduce((sum, t) => sum + t.grand_total, 0);

  return [
    { label: "Today's Revenue", value: format(revenueToday), icon: 'payments', color: 'primary' },
    { label: 'Stock at Cost', value: format(stockSummary.value.closingCostValue), icon: 'inventory_2', color: 'teal' },
    { label: 'Stock at Selling Price', value: format(stockSummary.value.closingRetailValue), icon: 'sell', color: 'indigo' },
    { label: 'Opening Stock at Cost', value: format(stockSummary.value.openingCostValue), icon: 'history', color: 'blue-grey' },
    { label: 'Closing Stock at Cost', value: format(stockSummary.value.closingCostValue), icon: 'inventory', color: 'positive' },
    { label: 'Open Quotations', value: transactionsStore.quotes.filter((q) => q.status === 'quote').length, icon: 'request_quote', color: 'orange' },
    { label: 'Total Products', value: productsStore.items.length, icon: 'category', color: 'secondary' },
    { label: 'Low Stock Items', value: productsStore.lowStock.length, icon: 'warning', color: 'negative' },
  ];
});

onMounted(async () => {
  await Promise.all([
    productsStore.fetchAll(),
    transactionsStore.fetchAll(),
    stockStore.fetchSummary({ from: dateISO(fiscalStart), to: `${dateISO(today)}T23:59:59` }),
  ]);
});
</script>

<style scoped>
.low-stock-card {
  min-height: 76px;
  border-radius: 8px;
  background: #fafafa;
}

.summary-card {
  min-height: 86px;
}

.stock-summary-card {
  border-left: 4px solid var(--q-primary);
}
</style>
