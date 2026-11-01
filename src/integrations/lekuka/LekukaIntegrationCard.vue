<template>
  <q-card flat bordered class="q-mb-md">
    <q-card-section class="row items-center">
      <div class="text-subtitle1">E-invoicing integration</div>
      <q-space />
      <q-chip
        v-if="modelValue === LEKUKA_INTEGRATION.id"
        dense
        color="orange"
        text-color="white"
        label="Setup required"
      />
    </q-card-section>
    <q-card-section class="q-gutter-y-sm">
      <q-option-group
        :model-value="modelValue"
        :options="E_INVOICE_PROVIDER_OPTIONS"
        type="radio"
        color="primary"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <div v-if="modelValue === LEKUKA_INTEGRATION.id" class="text-caption text-grey">
        Lekuka is selected but not connected yet. RSL device credentials and certificate setup are required before
        invoice submission can be enabled. The API supports testing and production environments.
      </div>
      <div v-else class="text-caption text-grey">
        No e-invoicing provider is selected. This does not affect local invoice creation or printing.
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { E_INVOICE_PROVIDER_OPTIONS, LEKUKA_INTEGRATION } from './index'

defineProps({
  modelValue: {
    type: String,
    default: 'none',
  },
})

const emit = defineEmits(['update:modelValue'])
</script>
