<template>
  <q-page>
    <div class="text-h5 q-mb-md">Business Letter</div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-lg-4">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium">Templates</div>
            <div class="text-caption text-grey-7 q-mt-xs">
              Click a template or drag it onto the Body field.
            </div>
          </q-card-section>

          <q-separator />

          <q-list separator>
            <q-item v-for="template in templates" :key="template.id" clickable draggable="true"
              @click="applyTemplate(template.id)" @dragstart="onTemplateDragStart($event, template.id)">
              <q-item-section>
                <q-item-label>{{ template.title }}</q-item-label>
                <q-item-label caption lines="2">{{ template.preview }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

      <div class="col-12 col-lg-8">
        <q-card flat bordered>
          <q-card-section class="q-gutter-md">
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-4">
                <q-input v-model="form.date" type="date" label="Date *" filled
                  :rules="[(v) => !!v || 'Date is required']" />
              </div>
              <div class="col-12 col-md-4">
                <q-input v-model="form.recipientName" label="Recipient Name *" filled />
              </div>
              <div class="col-12 col-md-4">
                <q-input v-model="form.recipientCompany" label="Recipient Company" filled />
              </div>
            </div>

            <q-input v-model="form.recipientAddress" label="Recipient Address" type="textarea" autogrow filled />

            <q-input v-model="form.subject" label="Subject *" filled />

            <q-card flat bordered class="letter-products-card">
              <q-card-section class="q-pb-sm">
                <div class="text-subtitle2 text-weight-medium">Product Table Builder</div>
                <div class="text-caption text-grey-7 q-mt-xs">
                  Add products and insert a mini table into the letter body.
                </div>
              </q-card-section>

              <q-card-section class="q-pt-none">
                <div class="row q-col-gutter-sm items-center q-mb-sm">
                  <div class="col-12 col-md-7">
                    <q-select v-model="pickedProductId" :options="productOptions" emit-value map-options use-input
                      filled dense label="Pick product" @filter="filterProducts" />
                  </div>
                  <div class="col-12 col-md-5 row q-gutter-sm justify-end">
                    <q-btn color="primary" outline label="Add Product" @click="addPickedProduct" />
                    <q-btn flat color="negative" label="Clear" :disable="!letterItems.length"
                      @click="clearLetterItems" />
                  </div>
                </div>

                <q-markup-table dense flat bordered class="letter-products-table">
                  <thead>
                    <tr>
                      <th class="text-left">Item</th>
                      <th class="text-left">Qty</th>
                      <th class="text-left">Price</th>
                      <th class="text-left">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, idx) in letterItems" :key="`${item.id}-${idx}`">
                      <td>{{ item.name }}</td>
                      <td style="width: 90px">
                        <q-input v-model.number="item.quantity" type="number" min="0.01" step="0.01" dense borderless />
                      </td>
                      <td style="width: 120px">
                        <q-input v-model.number="item.unitPrice" type="number" min="0" step="0.01" dense borderless />
                      </td>
                      <td style="width: 120px">{{ format(itemLineTotal(item)) }}</td>
                      <td style="width: 40px">
                        <q-btn flat dense round icon="close" size="sm" @click="removeLetterItem(idx)" />
                      </td>
                    </tr>
                    <tr v-if="!letterItems.length">
                      <td colspan="5" class="text-grey text-center">No products added yet.</td>
                    </tr>
                  </tbody>
                </q-markup-table>

                <div class="row items-center justify-between q-mt-sm">
                  <div class="text-caption text-grey-7">Subtotal: {{ format(letterItemsSubtotal) }}</div>
                  <q-btn color="primary" icon="table_chart" label="Insert Product Table" :disable="!letterItems.length"
                    @click="insertProductTable" />
                </div>
              </q-card-section>
            </q-card>

            <div class="letter-body-editor" @dragover.prevent="onBodyDragOver" @drop.prevent="onBodyDrop">
              <div class="text-caption text-grey-7 q-mb-xs">Body *</div>
              <q-editor v-model="form.body" min-height="200px" toolbar-bg="grey-2" :toolbar="[
                ['undo', 'redo'],
                ['bold', 'italic', 'underline', 'strike'],
                ['unordered', 'ordered', 'outdent', 'indent'],
                ['left', 'center', 'right', 'justify'],
                ['formatting', 'hr', 'quote', 'removeFormat'],
                ['link', 'fullscreen', 'viewsource']
              ]" />
              <div class="text-caption text-grey-7 q-mt-xs">
                Formatting in the editor is preserved in print and PDF output.
              </div>
            </div>

            <q-input v-model="form.closing" label="Conclusion / Closing" type="textarea" autogrow filled
              hint="Example: We appreciate your consideration and look forward to your response." />

            <q-input v-model="form.signature" label="Signature" filled
              hint="Name or title to show above the signature line" />
          </q-card-section>

          <q-separator />

          <q-card-actions align="right" class="q-pa-md">
            <q-btn flat label="Reset" @click="resetForm" />
            <q-btn outline label="Save Draft" @click="saveDraft" />
            <q-btn outline icon="print" label="Print" @click="printLetter" />
            <q-btn color="primary" icon="picture_as_pdf" label="Save PDF" :loading="savingPdf" @click="savePdf" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useSettingsStore } from 'src/stores/settings';
import { useProductsStore } from 'src/stores/products';
import { useCurrency } from 'src/composables/useCurrency';
import { renderBusinessLetter } from 'src/services/print-templates/letter';
import { usePrintDocument } from 'src/composables/usePrintDocument';
import { getLetterTemplateById, getLetterTemplates } from 'src/services/letter-templates';

const $q = useQuasar();
const settingsStore = useSettingsStore();
const productsStore = useProductsStore();
const { format } = useCurrency();
const { printHtml } = usePrintDocument();
const savingPdf = ref(false);
const DRAFT_KEY = 'business-letter-draft';
const AUTO_DRAFT_KEY = 'business-letter-autosave';
const AUTOSAVE_DELAY_MS = 500;
const TEMPLATE_DRAG_MIME = 'application/x-business-letter-template';
const pickedProductId = ref(null);
const productOptions = ref([]);
const letterItems = ref([]);
let autosaveTimer = null;

const templates = computed(() =>
  getLetterTemplates().map((template) => ({
    ...template,
    preview: htmlToPreview(template.body),
  }))
);

function htmlToPreview(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

function normalizeBodyToHtml(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';

  // If content already contains tags, treat it as HTML from the editor.
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) return raw;

  const withSimpleFormatting = raw
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>');

  return withSimpleFormatting
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emptyForm() {
  return {
    date: '',
    recipientName: '',
    recipientCompany: '',
    recipientAddress: '',
    subject: '',
    body: '',
    closing: 'Yours faithfully,',
    signature: '',
  };
}

const form = reactive(emptyForm());

function isValidForOutput() {
  if (!form.date) {
    $q.notify({ type: 'warning', message: 'Please select a date before saving or printing.' });
    return false;
  }
  return true;
}

function buildHtml() {
  return renderBusinessLetter(form, settingsStore.values);
}

function resetForm() {
  Object.assign(form, emptyForm());
  letterItems.value = [];
}

function applyTemplate(templateId) {
  const template = getLetterTemplateById(templateId);
  if (!template) return;

  form.body = normalizeBodyToHtml(template.body);
  $q.notify({ type: 'info', message: `Applied template: ${template.title}` });
}

function onTemplateDragStart(event, templateId) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(TEMPLATE_DRAG_MIME, templateId);
  event.dataTransfer.setData('text/plain', templateId);
  event.dataTransfer.effectAllowed = 'copy';
}

function onBodyDragOver(event) {
  if (!event.dataTransfer) return;
  event.dataTransfer.dropEffect = 'copy';
}

function onBodyDrop(event) {
  if (!event.dataTransfer) return;
  const templateId =
    event.dataTransfer.getData(TEMPLATE_DRAG_MIME) ||
    event.dataTransfer.getData('text/plain');
  if (!templateId) return;
  applyTemplate(templateId);
}

function filterProducts(val, update) {
  update(() => {
    const search = String(val || '').toLowerCase();
    productOptions.value = productsStore.items
      .filter((p) => p.name.toLowerCase().includes(search) || String(p.sku || '').toLowerCase().includes(search))
      .map((p) => ({
        label: `${p.name} (${format(p.selling_price)})`,
        value: p.id,
      }));
  });
}

function addPickedProduct() {
  if (!pickedProductId.value) {
    $q.notify({ type: 'warning', message: 'Pick a product first.' });
    return;
  }
  const product = productsStore.byId(pickedProductId.value);
  if (!product) {
    $q.notify({ type: 'warning', message: 'Product not found.' });
    return;
  }

  letterItems.value.push({
    id: product.id,
    name: product.name,
    quantity: 1,
    unitPrice: Number(product.selling_price || 0),
  });
  pickedProductId.value = null;
}

function removeLetterItem(index) {
  letterItems.value.splice(index, 1);
}

function clearLetterItems() {
  letterItems.value = [];
}

function itemLineTotal(item) {
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

const letterItemsSubtotal = computed(() =>
  letterItems.value.reduce((sum, item) => sum + itemLineTotal(item), 0)
);

function productTableHtml() {
  const rows = letterItems.value
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${Number(item.quantity || 0).toFixed(2)}</td>
          <td>${escapeHtml(format(item.unitPrice))}</td>
          <td>${escapeHtml(format(itemLineTotal(item)))}</td>
        </tr>`
    )
    .join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="3"><strong>Subtotal</strong></td>
          <td><strong>${escapeHtml(format(letterItemsSubtotal.value))}</strong></td>
        </tr>
      </tbody>
    </table>`;
}

function insertProductTable() {
  if (!letterItems.value.length) {
    $q.notify({ type: 'warning', message: 'Add at least one product first.' });
    return;
  }

  const html = productTableHtml();
  form.body = form.body?.trim() ? `${form.body}<p></p>${html}` : html;
  $q.notify({ type: 'positive', message: 'Product table inserted into letter body.' });
}

function draftPayload() {
  return {
    form: { ...form },
    letterItems: letterItems.value.map((item) => ({ ...item })),
    updatedAt: Date.now(),
  };
}

function parseDraft(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // Backward compatibility: previous format stored plain form object only.
    if (!parsed.form) {
      return {
        form: parsed,
        letterItems: [],
        updatedAt: Date.now(),
      };
    }

    return {
      form: parsed.form,
      letterItems: Array.isArray(parsed.letterItems) ? parsed.letterItems : [],
      updatedAt: Number(parsed.updatedAt || 0),
    };
  } catch {
    return null;
  }
}

function persistAutoDraft() {
  localStorage.setItem(AUTO_DRAFT_KEY, JSON.stringify(draftPayload()));
}

function scheduleAutoSave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  autosaveTimer = setTimeout(() => {
    persistAutoDraft();
    autosaveTimer = null;
  }, AUTOSAVE_DELAY_MS);
}

function beforeUnloadSave() {
  persistAutoDraft();
}

function saveDraft() {
  if (!isValidForOutput()) return;
  const payload = draftPayload();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  localStorage.setItem(AUTO_DRAFT_KEY, JSON.stringify(payload));
  $q.notify({ type: 'positive', message: 'Letter draft saved' });
}

async function printLetter() {
  if (!isValidForOutput()) return;
  try {
    await printHtml(buildHtml());
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not print letter' });
  }
}

async function savePdf() {
  if (!isValidForOutput()) return;
  if (!window.appBridge) {
    $q.notify({ type: 'negative', message: 'PDF export is only available in the desktop app.' });
    return;
  }

  savingPdf.value = true;
  try {
    const cleanSubject = (form.subject || 'business-letter').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'business-letter';
    const datePart = form.date.replace(/-/g, '');
    const result = await window.appBridge.printPdf({
      html: buildHtml(),
      defaultFileName: `LETTER-${datePart}-${cleanSubject}.pdf`,
    });
    if (result.opened === false) {
      $q.notify({ type: 'warning', message: `Saved: ${result.filePath}. Could not open automatically.` });
    } else {
      $q.notify({ type: 'positive', message: `Saved and opened: ${result.filePath}` });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    savingPdf.value = false;
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) {
    await settingsStore.fetchAll();
  }

  if (!productsStore.items.length) {
    await productsStore.fetchAll();
  }
  filterProducts('', (fn) => fn());

  const manualDraft = parseDraft(localStorage.getItem(DRAFT_KEY));
  const autoDraft = parseDraft(localStorage.getItem(AUTO_DRAFT_KEY));
  const restored =
    manualDraft && autoDraft
      ? (manualDraft.updatedAt >= autoDraft.updatedAt ? manualDraft : autoDraft)
      : (manualDraft || autoDraft);

  if (restored) {
    Object.assign(form, restored.form || {});
    letterItems.value = Array.isArray(restored.letterItems) ? restored.letterItems : [];
    form.body = normalizeBodyToHtml(form.body);
  }

  window.addEventListener('beforeunload', beforeUnloadSave);
});

watch(
  () => ({
    ...form,
    letterItems: letterItems.value.map((item) => ({ ...item })),
  }),
  () => {
    scheduleAutoSave();
  },
  { deep: true }
);

onBeforeUnmount(() => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  persistAutoDraft();
  window.removeEventListener('beforeunload', beforeUnloadSave);
});
</script>

<style scoped>
.letter-body-editor :deep(.q-editor) {
  border-radius: 4px;
}

.letter-products-card {
  background: var(--surface-1, #fff);
}
</style>
