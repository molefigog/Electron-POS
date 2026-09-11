import { defineStore } from 'pinia';
import TransactionRepository from 'src/services/repositories/TransactionRepository';
import { useProductsStore } from './products';
import { useSettingsStore } from './settings';

/** 'YYYY-MM-DD' for today, matching the format a native date input uses. */
function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `draft` holds the transaction currently being built/edited in the
 * TransactionForm - separate from `items` (the saved list) so navigating
 * away and back doesn't lose in-progress work, and so the same draft shape
 * can be saved as draft / quote / invoice.
 */
function emptyDraft() {
  return {
    id: null,
    type: 'quote', // 'quote' | 'invoice' | 'purchase_order'
    status: 'draft',
    customerId: null,
    supplierId: null,
    referenceQuotationNumber: null,
    manualReference: '', // optional, user-entered (PO number, customer ref, etc.) - independent of referenceQuotationNumber
    issuedAt: todayISODate(), // defaults to today; user can pick another date before saving
    notes: '',
    discountTotal: 0,
    lineItems: [], // { product_id, name, quantity, box_size?, box_count?, unit_price, discount_pct, tax_rate }
  };
}

export const useTransactionsStore = defineStore('transactions', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
    draft: emptyDraft(),
  }),

  getters: {
    quotes: (state) => state.items.filter((t) => t.type === 'quote'),
    invoices: (state) => state.items.filter((t) => t.type === 'invoice'),
    purchaseOrders: (state) => state.items.filter((t) => t.type === 'purchase_order'),

    draftHasPricedItems: (state) =>
      state.draft.lineItems.some((i) => i.unit_price !== null && i.unit_price !== '' && !Number.isNaN(Number(i.unit_price))),

    /** Sum of tax-inclusive line prices after per-line discount - NOT the tax-exclusive base. */
    draftGrossSubtotal: (state) =>
      state.draft.lineItems.reduce((sum, i) => {
        if (i.unit_price === null || i.unit_price === '' || Number.isNaN(Number(i.unit_price))) return sum;
        const base = i.quantity * Number(i.unit_price);
        const afterDiscount = base - base * ((i.discount_pct || 0) / 100);
        return sum + afterDiscount;
      }, 0),

    /** Tax portion EXTRACTED from the tax-inclusive prices, not added on top - see repositories.js for the identical main-process formula. */
    draftTaxTotal: (state) =>
      state.draft.lineItems.reduce((sum, i) => {
        if (i.unit_price === null || i.unit_price === '' || Number.isNaN(Number(i.unit_price))) return sum;
        const base = i.quantity * Number(i.unit_price);
        const afterDiscount = base - base * ((i.discount_pct || 0) / 100);
        const rate = i.tax_rate || 0;
        const tax = rate > 0 ? afterDiscount - afterDiscount / (1 + rate / 100) : 0;
        return sum + tax;
      }, 0),

    /** Tax-exclusive base, shown only as a receipt breakdown line - never the amount charged. */
    draftSubtotal() {
      return this.draftGrossSubtotal - this.draftTaxTotal;
    },

    /** What the customer actually pays: tax-inclusive gross total minus any header-level discount. */
    draftGrandTotal(state) {
      return this.draftGrossSubtotal - (state.draft.discountTotal || 0);
    },
  },

  actions: {
    async fetchAll(filters = {}) {
      this.loading = true;
      this.error = null;
      try {
        this.items = await TransactionRepository.all(filters);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(id) {
      return TransactionRepository.find(id);
    },

    startNewDraft(type = 'quote') {
      this.draft = { ...emptyDraft(), type };
    },

    /** Load an existing transaction into the editable draft (for edit or duplicate) */
    loadIntoDraft(tx) {
      this.draft = {
        id: tx.id,
        type: tx.type,
        status: tx.status,
        customerId: tx.customer_id,
        supplierId: tx.supplier_id,
        referenceQuotationNumber: tx.reference_quotation_number,
        manualReference: tx.manual_reference || '',
        issuedAt: String(tx.issued_at || tx.created_at).slice(0, 10),
        notes: tx.notes || '',
        discountTotal: tx.discount_total || 0,
        lineItems: (tx.items || []).map((i) => ({
          product_id: i.product_id,
          name: i.name,
          quantity: i.quantity,
          box_size: i.box_size ?? null,
          box_count: i.box_count ?? null,
          unit_price: i.unit_price,
          discount_pct: i.discount_pct,
          tax_rate: i.tax_rate,
        })),
      };
    },

    /**
     * Adds (or bumps the quantity of) a line item and returns its index in
     * `lineItems` - the caller uses this to auto-focus that row's Quantity
     * input. If the product has no tax of its own, falls back to the global
     * default_tax_rate from Settings (added in migration v4) rather than
     * silently charging 0% tax.
     */
    addLineItem(product, quantity = 1) {
      const existingIdx = this.draft.lineItems.findIndex((i) => i.product_id === product.id);
      if (existingIdx !== -1) {
        this.draft.lineItems[existingIdx].quantity += quantity;
        return existingIdx;
      }
      const settingsStore = useSettingsStore();
      const fallbackRate = Number(settingsStore.values.default_tax_rate || 0);

      this.draft.lineItems.push({
        product_id: product.id,
        name: product.name,
        quantity,
        box_size: null,
        box_count: null,
        unit_price: this.draft.type === 'purchase_order' ? null : product.selling_price, // tax-inclusive
        discount_pct: 0,
        tax_rate: product.tax_rate ?? fallbackRate,
      });
      return this.draft.lineItems.length - 1;
    },

    removeLineItem(index) {
      this.draft.lineItems.splice(index, 1);
    },

    /**
     * Persists the current draft as a draft, quote, or invoice.
     * `saveAs` overrides draft.type/status for this save (e.g. finalize a
     * draft into a real quote, or save straight to invoice for a walk-in sale).
     */
    async saveDraft(saveAs) {
      const type = saveAs === 'invoice'
        ? 'invoice'
        : saveAs === 'quote'
          ? 'quote'
          : saveAs === 'purchase_order'
            ? 'purchase_order'
            : this.draft.type;
      const status = saveAs || (type === 'quote' ? 'quote' : type === 'invoice' ? 'invoice' : 'purchase_order');

      const payload = {
        type,
        status,
        customerId: this.draft.customerId,
        supplierId: this.draft.supplierId,
        notes: this.draft.notes,
        discountTotal: this.draft.discountTotal || 0,
        items: this.draft.lineItems,
        issuedAt: this.draft.issuedAt || todayISODate(),
        manualReference: this.draft.manualReference || null,
      };

      let saved;
      if (this.draft.id) {
        saved = await TransactionRepository.update(this.draft.id, payload);
      } else {
        saved = await TransactionRepository.create(payload);
      }

      await this.fetchAll();
      if (type === 'invoice') {
        // stock changed - keep the products store's cached quantities fresh
        const productsStore = useProductsStore();
        await productsStore.fetchAll();
      }
      this.draft = emptyDraft();
      return saved;
    },

    /**
     * The headline feature: quote -> invoice with zero re-entry - copies
     * everything (items, totals, notes, manual reference). `issuedAt` is
     * optional; omit it to preserve the quote's original date, or pass a
     * new date string ('YYYY-MM-DD') to override it.
     */
    async convertToInvoice(quoteId, issuedAt = null) {
      const invoice = await TransactionRepository.convertToInvoice(quoteId, issuedAt ? { issuedAt } : {});
      await this.fetchAll();
      const productsStore = useProductsStore();
      await productsStore.fetchAll();
      return invoice;
    },

    async remove(id) {
      await TransactionRepository.delete(id);
      this.items = this.items.filter((t) => t.id !== id);
    },
  },
});
