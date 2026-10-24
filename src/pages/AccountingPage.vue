<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="text-h5">Accounting</div>
    </div>

    <q-banner v-if="blocked" rounded class="bg-orange-1 text-dark">
      <template #avatar><q-icon name="info" color="orange" /></template>
      {{ blocked }}
    </q-banner>

    <template v-else>
      <q-tabs v-model="tab" dense align="left" class="text-grey-7" active-color="primary" indicator-color="primary" narrow-indicator>
        <q-tab v-for="t in tabs" :key="t.name" :name="t.name" :icon="t.icon" :label="t.label" no-caps />
      </q-tabs>
      <q-separator />
      <q-tab-panels v-model="tab" animated class="bg-transparent">
        <q-tab-panel name="overview" class="q-px-none"><OverviewTab /></q-tab-panel>
        <q-tab-panel name="receivables" class="q-px-none"><ReceivablesTab /></q-tab-panel>
        <q-tab-panel name="expenses" class="q-px-none"><ExpensesTab /></q-tab-panel>
        <q-tab-panel name="bills" class="q-px-none"><BillsTab /></q-tab-panel>
        <q-tab-panel name="journal" class="q-px-none"><JournalTab /></q-tab-panel>
        <q-tab-panel name="accounts" class="q-px-none"><AccountsTab /></q-tab-panel>
        <q-tab-panel name="reports" class="q-px-none"><ReportsTab /></q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>

<script setup>
import { ref, computed } from 'vue';
import { isApiMode } from 'src/services/connection';
import OverviewTab from 'src/components/accounting/OverviewTab.vue';
import ReceivablesTab from 'src/components/accounting/ReceivablesTab.vue';
import ExpensesTab from 'src/components/accounting/ExpensesTab.vue';
import BillsTab from 'src/components/accounting/BillsTab.vue';
import JournalTab from 'src/components/accounting/JournalTab.vue';
import AccountsTab from 'src/components/accounting/AccountsTab.vue';
import ReportsTab from 'src/components/accounting/ReportsTab.vue';

const tab = ref('overview');
const tabs = [
  { name: 'overview', label: 'Overview', icon: 'space_dashboard' },
  { name: 'receivables', label: 'Receivables', icon: 'request_quote' },
  { name: 'expenses', label: 'Expenses', icon: 'receipt' },
  { name: 'bills', label: 'Supplier bills', icon: 'local_shipping' },
  { name: 'journal', label: 'Journal', icon: 'menu_book' },
  { name: 'accounts', label: 'Accounts', icon: 'account_tree' },
  { name: 'reports', label: 'Reports', icon: 'assessment' },
];

const blocked = computed(() => {
  if (isApiMode()) return 'Accounting is available when the app uses its own database (single PC or LAN). Switch off internet API mode in Settings to use it.';
  if (typeof window !== 'undefined' && !window.dbBridge) return 'Accounting is only available inside the desktop app.';
  return '';
});
</script>
