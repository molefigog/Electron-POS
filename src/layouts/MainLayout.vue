<template>
  <q-layout view="hHh lpR fFf">
    <q-header ref="headerRef" elevated class="win-header">
      <div class="win-titlebar">
        <img v-if="settingsStore.values.company_logo" :src="settingsStore.values.company_logo" alt="Company logo"
          class="win-brand-logo q-mr-xs" />
        <q-icon v-else name="point_of_sale" size="18px" class="q-mr-xs" />
        <span class="win-title">{{ companyName }}</span>
      </div>

      <q-toolbar class="win-toolbar">
        <q-btn v-for="item in navItems" :key="item.route" stack no-caps unelevated class="win-toolbar-btn"
          :class="{ 'win-toolbar-btn--active': isActive(item.route) }" @click="$router.push(item.route)">
          <q-icon :name="item.icon" size="22px" />
          <span class="win-toolbar-label">{{ item.label }}</span>
        </q-btn>

        <q-space />

        <q-btn flat dense round icon="settings" class="win-toolbar-settings" to="/settings">
          <q-tooltip>Settings</q-tooltip>
        </q-btn>
      </q-toolbar>

      <q-toolbar v-if="isTransactionsRoute" class="pos-toolbar">
        <q-btn flat no-caps icon="note_add" label="New Transaction" @click="startNewFromMode" />

        <q-btn-toggle v-model="posDraftType" no-caps unelevated toggle-color="primary" color="grey-2"
          text-color="grey-8" :options="transactionTypeOptions" :disable="!!transactionsStore.draft.id"
          class="pos-type-toggle" />
        <q-btn flat no-caps icon="history" label="Recent Transactions" @click="openRecentTransactions" />

        <q-space />

        <TemplateSwitcher v-model="settingsStore.values.print_template" @update:model-value="onTemplateChange" />
      </q-toolbar>
    </q-header>

    <q-page-container class="desktop-container">
      <div ref="workspaceRef" class="desktop-workspace" :style="workspaceStyle">
        <section ref="windowRef" class="desktop-window" :class="{ 'desktop-window--dragging': isDragging }"
          :style="windowStyle" :data-window-mode="windowMode">
          <header class="desktop-window__titlebar" @pointerdown="startDrag">
            <div class="desktop-window__title">
              <q-icon :name="activeNavItem?.icon || 'apps'" size="16px" />
              <span>{{ activeWindowTitle }}</span>
            </div>
            <div class="desktop-window__controls">
              <q-btn flat dense round size="sm" icon="first_page" @click.stop="snapLeft">
                <q-tooltip>Snap left</q-tooltip>
              </q-btn>
              <q-btn flat dense round size="sm" icon="last_page" @click.stop="snapRight">
                <q-tooltip>Snap right</q-tooltip>
              </q-btn>
              <q-btn flat dense round size="sm" :icon="windowMode === 'maximized' ? 'filter_none' : 'crop_square'"
                @click.stop="toggleMaximize">
                <q-tooltip>{{ windowMode === 'maximized' ? 'Restore' : 'Maximize' }}</q-tooltip>
              </q-btn>
              <q-btn flat dense round size="sm" icon="center_focus_strong" @click.stop="centerWindow">
                <q-tooltip>Center window</q-tooltip>
              </q-btn>
            </div>
          </header>

          <div class="desktop-window__content" :class="{ 'desktop-window__content--with-pos': isTransactionsRoute }">
            <router-view />
          </div>

          <footer v-if="isTransactionsRoute" class="pos-totals-bar">
            <div class="pos-totals-bar__group">
              <div class="pos-totals-bar__line">
                <span>Subtotal</span>
                <strong>{{ summaryAmount(transactionsStore.draftSubtotal) }}</strong>
              </div>
              <div class="pos-totals-bar__line" v-if="showTaxLine">
                <span>Tax</span>
                <strong>{{ summaryAmount(transactionsStore.draftTaxTotal) }}</strong>
              </div>
              <div class="pos-totals-bar__line pos-totals-bar__line--editable">
                <span>Discount</span>
                <q-input v-model.number="transactionsStore.draft.discountTotal" type="number" dense borderless min="0"
                  class="pos-totals-bar__discount"
                  :disable="transactionsStore.draft.type === 'purchase_order' && !transactionsStore.draftHasPricedItems" />
              </div>
            </div>

            <div class="pos-totals-bar__grand">
              <div class="text-caption">Grand Total</div>
              <div class="text-h5">{{ summaryAmount(transactionsStore.draftGrandTotal) }}</div>
            </div>

            <div class="pos-totals-bar__actions">
              <q-btn outline no-caps label="Save Draft" :loading="savingTransaction"
                @click="saveTransaction('draft')" />
              <q-btn color="primary" no-caps :label="primaryActionLabel" :loading="savingTransaction"
                :disable="!transactionsStore.draft.lineItems.length" @click="saveTransaction(primaryActionType)" />
            </div>
          </footer>
        </section>
      </div>
    </q-page-container>

    <q-dialog v-model="showRecentTransactions" maximized>
      <q-card class="recent-transactions-dialog">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Recent Transactions</div>
          <q-space />
          <q-btn flat round dense icon="close" v-close-popup />
        </q-card-section>
        <q-card-section class="recent-transactions-dialog__body">
          <TransactionList @edit="handleHistoryEdit" />
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showPostSaveDialog" persistent>
      <q-card style="min-width: 420px; max-width: 92vw;">
        <q-card-section class="text-h6">{{ postSaveDialogTitle }}</q-card-section>
        <q-card-section>
          <div class="text-body2">Choose what to do next for {{ lastSavedTransaction?.number }}.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Print Document" :disable="!lastSavedTransaction" @click="printLastSaved" />
          <q-btn flat no-caps label="Save as PDF" :disable="!lastSavedTransaction" @click="exportLastSavedPdf" />
          <q-btn color="primary" no-caps label="Close" @click="showPostSaveDialog = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRoute } from 'vue-router';
import { useTransactionsStore } from 'src/stores/transactions';
import { useSettingsStore } from 'src/stores/settings';
import { useCurrency } from 'src/composables/useCurrency';
import { usePrintDocument } from 'src/composables/usePrintDocument';
import TemplateSwitcher from 'src/components/print-templates/TemplateSwitcher.vue';
import TransactionList from 'src/components/transactions/TransactionList.vue';

const route = useRoute();
const $q = useQuasar();
const transactionsStore = useTransactionsStore();
const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { print, exportPdf } = usePrintDocument();

const workspaceRef = ref(null);
const windowRef = ref(null);
const headerRef = ref(null);
const isDragging = ref(false);
const hasPositioned = ref(false);
const windowMode = ref('floating');
const savingTransaction = ref(false);
const showRecentTransactions = ref(false);
const showPostSaveDialog = ref(false);
const lastSavedTransaction = ref(null);
const headerHeight = ref(102);

const windowPosition = reactive({ x: 30, y: 24 });
const floatingPosition = reactive({ x: 30, y: 24 });
const dragState = reactive({
  pointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
});

let resizeObserver;

const navItems = [
  { route: '/transactions', label: 'Transactions', icon: 'receipt_long' },
  { route: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { route: '/letters', label: 'Letters', icon: 'description' },
  { route: '/products', label: 'Products', icon: 'inventory_2' },
  { route: '/customers', label: 'Customers', icon: 'people' },
  { route: '/stock', label: 'Stock', icon: 'warehouse' },
  { route: '/reports', label: 'Reports', icon: 'bar_chart' },
  { route: '/help', label: 'Help', icon: 'help_outline' },
];

const transactionTypeOptions = [
  { label: 'Quotation', value: 'quote' },
  { label: 'Invoice', value: 'invoice' },
  { label: 'Purchase Order', value: 'purchase_order' },
];

const currentPath = computed(() => route.path);
const companyName = computed(() => String(settingsStore.values.company_name || 'My Company').trim() || 'My Company');
const activeNavItem = computed(() => navItems.find((item) => isActive(item.route)));
const activeWindowTitle = computed(() => activeNavItem.value?.label || String(route.name || 'Workspace'));
const isTransactionsRoute = computed(() => currentPath.value === '/transactions');
const posDraftType = computed({
  get: () => transactionsStore.draft.type,
  set: (type) => {
    if (!transactionsStore.draft.id) {
      transactionsStore.draft.type = type;
    }
  },
});
const showTaxLine = computed(() => Number(transactionsStore.draftTaxTotal || 0) > 0);
const primaryActionType = computed(() => transactionsStore.draft.type);
const primaryActionLabel = computed(() => {
  return {
    quote: 'Save Quotation',
    invoice: 'Save Invoice',
    purchase_order: 'Save Purchase Order',
  }[primaryActionType.value] || 'Save';
});

const workspaceStyle = computed(() => ({
  height: `calc(100vh - ${headerHeight.value}px)`,
}));

const windowStyle = computed(() => {
  if (windowMode.value === 'maximized') {
    return {
      width: 'calc(100% - 24px)',
      height: 'calc(100% - 24px)',
      transform: 'translate3d(0px, 0px, 0)',
    };
  }

  if (windowMode.value === 'snap-left') {
    return {
      width: 'calc(50% - 18px)',
      height: 'calc(100% - 24px)',
      transform: 'translate3d(0px, 0px, 0)',
    };
  }

  if (windowMode.value === 'snap-right') {
    return {
      width: 'calc(50% - 18px)',
      height: 'calc(100% - 24px)',
      transform: 'translate3d(calc(50% - 6px), 0px, 0)',
    };
  }

  return {
    width: 'min(1280px, calc(100% - 24px))',
    height: 'calc(100% - 24px)',
    transform: `translate3d(${windowPosition.x}px, ${windowPosition.y}px, 0)`,
  };
});

function isActive(path) {
  if (path === '/') return currentPath.value === '/';
  return currentPath.value.startsWith(path);
}

function summaryAmount(amount) {
  if (transactionsStore.draft.type === 'purchase_order' && !transactionsStore.draftHasPricedItems) return '-';
  return format(amount);
}

function startNewFromMode() {
  transactionsStore.startNewDraft(transactionsStore.draft.type);
}

async function openRecentTransactions() {
  await transactionsStore.fetchAll();
  showRecentTransactions.value = true;
}

function handleHistoryEdit() {
  showRecentTransactions.value = false;
}

const postSaveDialogTitle = computed(() => {
  const savedType = lastSavedTransaction.value?.type;
  return {
    quote: 'Quotation Saved',
    invoice: 'Invoice Saved',
    purchase_order: 'Purchase Order Saved',
  }[savedType] || 'Transaction Saved';
});

function shouldShowPostSaveDialog(saveAs) {
  return ['quote', 'invoice', 'purchase_order'].includes(saveAs);
}

async function printLastSaved() {
  if (!lastSavedTransaction.value) return;
  try {
    await print(lastSavedTransaction.value);
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not print document' });
  }
}

async function exportLastSavedPdf() {
  if (!lastSavedTransaction.value) return;
  try {
    const result = await exportPdf(lastSavedTransaction.value);
    if (result.opened === false) {
      $q.notify({ type: 'warning', message: `Saved: ${result.filePath}. Could not open automatically.` });
    } else {
      $q.notify({ type: 'positive', message: `Saved and opened: ${result.filePath}` });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  }
}

async function saveTransaction(saveAs) {
  savingTransaction.value = true;
  try {
    const saved = await transactionsStore.saveDraft(saveAs);
    lastSavedTransaction.value = saved;

    if (shouldShowPostSaveDialog(saveAs)) {
      showPostSaveDialog.value = true;
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    savingTransaction.value = false;
  }
}

function onTemplateChange(val) {
  settingsStore.update({ print_template: val });
}

function updateHeaderHeight() {
  const headerEl = headerRef.value?.$el || headerRef.value;
  const measured = Number(headerEl?.offsetHeight || 0);
  if (measured > 0) {
    headerHeight.value = measured;
  }
}

function clampPosition(x, y) {
  const workspaceEl = workspaceRef.value;
  const windowEl = windowRef.value;
  if (!workspaceEl || !windowEl) return { x, y };

  const margin = 12;
  const maxX = Math.max(margin, workspaceEl.clientWidth - windowEl.offsetWidth - margin);
  const maxY = Math.max(margin, workspaceEl.clientHeight - windowEl.offsetHeight - margin);

  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

function constrainWindow() {
  if (windowMode.value !== 'floating') return;
  const bounded = clampPosition(windowPosition.x, windowPosition.y);
  windowPosition.x = bounded.x;
  windowPosition.y = bounded.y;
}

function centerWindow() {
  if (windowMode.value !== 'floating') {
    restoreFloating();
  }

  const workspaceEl = workspaceRef.value;
  const windowEl = windowRef.value;
  if (!workspaceEl || !windowEl) return;

  const centeredX = (workspaceEl.clientWidth - windowEl.offsetWidth) / 2;
  const centeredY = Math.max(14, (workspaceEl.clientHeight - windowEl.offsetHeight) / 2);
  const bounded = clampPosition(centeredX, centeredY);
  windowPosition.x = bounded.x;
  windowPosition.y = bounded.y;
  floatingPosition.x = bounded.x;
  floatingPosition.y = bounded.y;
}

function saveFloatingPosition() {
  floatingPosition.x = windowPosition.x;
  floatingPosition.y = windowPosition.y;
}

function restoreFloating() {
  windowMode.value = 'floating';
  windowPosition.x = floatingPosition.x;
  windowPosition.y = floatingPosition.y;
  nextTick(() => {
    constrainWindow();
    saveFloatingPosition();
  });
}

function setWindowMode(mode) {
  if (mode === windowMode.value) {
    if (mode !== 'floating') restoreFloating();
    return;
  }

  if (windowMode.value === 'floating') {
    saveFloatingPosition();
  }
  windowMode.value = mode;
}

function snapLeft() {
  setWindowMode('snap-left');
}

function snapRight() {
  setWindowMode('snap-right');
}

function toggleMaximize() {
  if (windowMode.value === 'maximized') {
    restoreFloating();
    return;
  }
  setWindowMode('maximized');
}

function onDragMove(event) {
  if (!isDragging.value || event.pointerId !== dragState.pointerId) return;
  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  const next = clampPosition(dragState.originX + deltaX, dragState.originY + deltaY);
  windowPosition.x = next.x;
  windowPosition.y = next.y;
  floatingPosition.x = next.x;
  floatingPosition.y = next.y;
}

function stopDrag(event) {
  if (event && dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
  isDragging.value = false;
  dragState.pointerId = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('pointercancel', stopDrag);
}

function startDrag(event) {
  if (event.button !== 0 || event.target.closest('.desktop-window__controls')) return;

  if (windowMode.value !== 'floating') {
    restoreFloating();
  }

  dragState.pointerId = event.pointerId;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.originX = windowPosition.x;
  dragState.originY = windowPosition.y;
  isDragging.value = true;

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
}

watch(
  () => route.fullPath,
  () => {
    nextTick(() => {
      updateHeaderHeight();
      constrainWindow();
    });
  },
);

watch(isTransactionsRoute, () => {
  nextTick(() => {
    updateHeaderHeight();
    constrainWindow();
  });
});

onMounted(() => {
  nextTick(() => {
    updateHeaderHeight();
    centerWindow();
    hasPositioned.value = true;
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();

      if (!hasPositioned.value) {
        centerWindow();
        hasPositioned.value = true;
        return;
      }

      if (windowMode.value === 'floating') {
        constrainWindow();
      }
    });

    if (workspaceRef.value) resizeObserver.observe(workspaceRef.value);
    if (windowRef.value) resizeObserver.observe(windowRef.value);
    const headerEl = headerRef.value?.$el || headerRef.value;
    if (headerEl) resizeObserver.observe(headerEl);
  }
});

onBeforeUnmount(() => {
  stopDrag();
  if (resizeObserver) resizeObserver.disconnect();
});
</script>

<style scoped>
.win-header {
  background: var(--surface-2);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

.win-titlebar {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  background: linear-gradient(to bottom, var(--surface-1), var(--surface-2));
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.win-title {
  letter-spacing: 0.3px;
}

.win-brand-logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  border-radius: 3px;
}

.win-toolbar {
  background: var(--surface-2);
  padding: 4px 6px;
  min-height: 68px;
  gap: 2px;
}

.win-toolbar-btn {
  min-width: 68px;
  height: 58px;
  padding: 4px 8px;
  border-radius: 3px;
  color: var(--text-secondary);
  border: 1px solid transparent;
}

.win-toolbar-btn :deep(.q-icon) {
  color: var(--accent-soft);
}

.win-toolbar-label {
  font-size: 11px;
  margin-top: 2px;
  line-height: 1.1;
}

.win-toolbar-btn:hover {
  background: var(--surface-hover);
  border: 1px solid var(--accent-border);
}

.win-toolbar-btn--active {
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
}

.win-toolbar-settings {
  color: var(--text-secondary);
}

.pos-toolbar {
  min-height: 52px;
  padding: 6px 10px;
  gap: 6px;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  border-top: 1px solid var(--border-color);
}

.pos-type-toggle {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.pos-type-toggle :deep(.q-btn) {
  min-height: 34px;
  padding: 0 14px;
  font-weight: 600;
}

.pos-type-toggle :deep(.q-btn:not(.q-btn--active)) {
  background: var(--surface-1);
  color: var(--text-secondary);
}

.recent-transactions-dialog {
  height: 100%;
}

.recent-transactions-dialog__body {
  height: calc(100% - 58px);
  overflow: auto;
}

.desktop-container {
  min-height: 0;
}

.desktop-workspace {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  padding: 16px;
  background:
    radial-gradient(circle at 14% 18%, color-mix(in srgb, var(--desk-accent) 22%, transparent) 0%, transparent 45%),
    radial-gradient(circle at 86% 12%, color-mix(in srgb, var(--desk-accent-2) 20%, transparent) 0%, transparent 40%),
    linear-gradient(145deg, var(--desk-bg-1), var(--desk-bg-2) 42%, var(--desk-bg-3));
}

.desktop-window {
  position: absolute;
  inset: 0 auto auto 0;
  width: min(1280px, calc(100% - 24px));
  height: calc(100% - 24px);
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  box-shadow: var(--window-shadow);
  transition: transform 0.12s ease, width 0.16s ease, height 0.16s ease, border-radius 0.16s ease;
  will-change: transform;
  overflow: hidden;
}

.desktop-window[data-window-mode='maximized'],
.desktop-window[data-window-mode='snap-left'],
.desktop-window[data-window-mode='snap-right'] {
  border-radius: 10px;
}

.desktop-window--dragging {
  transition: none;
}

.desktop-window__titlebar {
  height: 42px;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--surface-1) 84%, white), var(--surface-2));
  border-bottom: 1px solid var(--border-color);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.desktop-window__titlebar:active {
  cursor: grabbing;
}

.desktop-window__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.desktop-window__controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.desktop-window__content {
  height: calc(100% - 42px);
  overflow: auto;
}

.desktop-window__content :deep(.q-page) {
  min-height: 100% !important;
}

.desktop-window__content--with-pos {
  height: calc(100% - 42px - 88px);
}

.pos-totals-bar {
  height: 88px;
  border-top: 1px solid var(--border-color);
  background: linear-gradient(to bottom, color-mix(in srgb, var(--surface-1) 95%, white), var(--surface-2));
  padding: 8px 12px;
  display: grid;
  grid-template-columns: minmax(340px, 1fr) auto auto;
  align-items: center;
  gap: 14px;
}

.pos-totals-bar__group {
  display: inline-flex;
  align-items: center;
  gap: 18px;
}

.pos-totals-bar__line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.pos-totals-bar__line--editable {
  align-items: center;
}

.pos-totals-bar__discount {
  width: 96px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0 6px;
}

.pos-totals-bar__grand {
  text-align: right;
  min-width: 180px;
}

.pos-totals-bar__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 1024px) {
  .desktop-workspace {
    padding: 10px;
  }

  .desktop-window {
    width: calc(100% - 20px);
    height: calc(100% - 20px);
    border-radius: 10px;
  }

  .desktop-window[data-window-mode='snap-left'],
  .desktop-window[data-window-mode='snap-right'] {
    width: calc(100% - 20px) !important;
    transform: translate3d(0px, 0px, 0) !important;
  }

  .desktop-window__content--with-pos {
    height: calc(100% - 42px - 124px);
  }

  .pos-totals-bar {
    height: 124px;
    grid-template-columns: 1fr;
    gap: 6px;
    align-content: center;
  }

  .pos-totals-bar__group {
    gap: 12px;
    flex-wrap: wrap;
  }

  .pos-totals-bar__grand,
  .pos-totals-bar__actions {
    justify-self: stretch;
    text-align: left;
  }
}
</style>
