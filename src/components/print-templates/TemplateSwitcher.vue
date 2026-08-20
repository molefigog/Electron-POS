<template>
  <q-btn-dropdown color="primary" outline :label="`Template: ${currentLabel}`" icon="palette">
    <q-list>
      <q-item
        v-for="(tpl, key) in PRINT_TEMPLATES"
        :key="key"
        clickable
        v-close-popup
        :active="key === modelValue"
        @click="$emit('update:modelValue', key)"
      >
        <q-item-section>{{ tpl.label }}</q-item-section>
        <q-item-section side v-if="key === modelValue">
          <q-icon name="check" color="primary" />
        </q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script setup>
import { computed } from 'vue';
import { PRINT_TEMPLATES } from 'src/services/print-templates/registry';

const props = defineProps({
  modelValue: { type: String, required: true },
});
defineEmits(['update:modelValue']);

const currentLabel = computed(() => PRINT_TEMPLATES[props.modelValue]?.label || 'Classic');
</script>
