<template>
  <div>
    <div class="row items-center q-mb-md">
      <div class="text-subtitle1">Position as at {{ data?.today }}</div>
      <q-space />
      <q-btn flat dense no-caps icon="refresh" label="Refresh" :loading="loading" @click="load" />
    </div>

    <q-banner v-if="data && !data.vat.registered" dense rounded class="bg-orange-1 text-dark q-mb-md">
      <template #avatar><q-icon name="info" color="orange" /></template>
      No VAT number is set (Settings &rarr; company VAT), so VAT on expenses and bills is not claimed.
      VAT on sales is still reported from each invoice's tax rate.
    </q-banner>
    <q-banner v-if="data?.lockDate" dense rounded class="bg-blue-1 text-dark q-mb-md">
      <template #avatar><q-icon name="lock" color="primary" /></template>
      Books are closed up to {{ data.lockDate }}. Nothing on or before that date can be changed.
    </q-banner>

    <div v-if="data" class="row q-col-gutter-md">
      <div v-for="card in cards" :key="card.label" class="col-12 col-sm-6 col-md-4">
        <q-card flat bordered class="full-height">
          <q-card-section>
            <div class="text-caption text-grey">{{ card.label }}</div>
            <div class="text-h5" :class="card.negative ? 'text-negative' : ''">{{ format(card.value) }}</div>
            <div v-if="card.hint" class="text-caption text-grey q-mt-xs">{{ card.hint }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div v-if="data" class="row q-col-gutter-md q-mt-sm">
      <div v-for="p in periods" :key="p.title" class="col-12 col-md-6">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle2 q-mb-sm">{{ p.title }}</div>
            <q-markup-table flat dense separator="none">
              <tbody>
                <tr><td>Sales (excl. VAT)</td><td class="text-right">{{ format(p.v.sales) }}</td></tr>
                <tr><td>Cost of sales</td><td class="text-right">{{ format(p.v.cogs) }}</td></tr>
                <tr><td>Expenses</td><td class="text-right">{{ format(p.v.expenses) }}</td></tr>
                <tr class="text-weight-bold">
                  <td>Net profit</td>
                  <td class="text-right" :class="p.v.profit < 0 ? 'text-negative' : 'text-positive'">{{ format(p.v.profit) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import { useCurrency } from 'src/composables/useCurrency';
import { useAccountingUi } from 'src/composables/useAccountingUi';

const { format } = useCurrency();
const { fail } = useAccountingUi();
const data = ref(null);
const loading = ref(false);

const cards = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    { label: 'Money on hand', value: d.cash.total, hint: `Cash ${format(d.cash.cash)} - Bank ${format(d.cash.bank)} - Mobile money ${format(d.cash.mobileMoney)}`, negative: d.cash.total < 0 },
    { label: 'Owed to you (receivables)', value: d.receivables },
    { label: 'You owe (payables)', value: d.payables },
    { label: d.vatPayable >= 0 ? 'VAT payable (all time)' : 'VAT refundable (all time)', value: Math.abs(d.vatPayable) },
    { label: 'Inventory (ledger)', value: d.inventory, hint: 'Post opening stock in Journal if this looks low.' },
  ];
});
const periods = computed(() =>
  data.value ? [{ title: 'This month', v: data.value.month }, { title: 'This year', v: data.value.year }] : [],
);

async function load() {
  loading.value = true;
  try {
    data.value = await AccountingRepository.overview();
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
