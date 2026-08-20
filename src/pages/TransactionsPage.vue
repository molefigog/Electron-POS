<template>
  <q-page class="transactions-page">
    <section class="transactions-shell">
      <TransactionForm />
    </section>
  </q-page>
</template>

<script setup>
import TransactionForm from 'src/components/transactions/TransactionForm.vue';
</script>

<style scoped>
.transactions-page {
  height: 100%;
  padding: 8px;
}

.transactions-shell {
  height: 100%;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-1);
  overflow: hidden;
}
</style>
