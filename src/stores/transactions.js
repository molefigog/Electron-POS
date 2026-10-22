import { defineStore } from 'pinia';
import TransactionRepository from 'src/services/repositories/TransactionRepository';
import { useProductsStore } from './products';
import { useSettingsStore } from './settings';
import { PAYMENT_METHODS } from 'src/constants/payments';

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
    posMode: false, // POS sale: an invoice with a cash tender (see MainLayout "POS" button)
    amountTendered: '', // POS only: cash handed over when paying by cash alone ('' until typed)
    payMethods: [], // POS only: ticked payment methods; none ticked = cash
    payAmounts: {}, // POS only: { [method]: amount } when two or more methods are ticked (split payment)
    lineItems: [], // { product_id, name, quantity, box_size?, box_count?, unit_price, discount_pct, tax_rate }
  };
}

/** Restores the payment inputs of a saved POS sale into the draft shape. */
function paymentsToDraft(tx) {
  const payments = Array.isArray(tx.payments) ? tx.payments : [];
  if (!payments.length) {
    return { amountTendered: tx.amount_tendered ?? '', payMethods: [], payAmounts: {} };
  }
  if (payments.length === 1) {
    const [only] = payments;
    return { amountTendered: only.method === 'cash' ? only.amount : '', payMethods: only.method === 'cash' ? [] : [only.method], payAmounts: {} };
  }
  return {
    amountTendered: '',
    payMethods: payments.map((p) => p.method),
    payAmounts: Object.fromEntries(payments.map((p) => [p.method, p.amount])),
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

    /** Ticked payment methods in screen order; cash when nothing is ticked. */
    draftPayMethods(state) {
      const ticked = PAYMENT_METHODS.map((m) => m.value).filter((m) => (state.draft.payMethods || []).includes(m));
      return ticked.length ? ticked : ['cash'];
    },

    /**
     * What the customer hands over, per method: [{ method, amount }].
     * One non-cash method = exactly the total (no change possible); cash alone = the
     * typed Tendered box; two or more methods = the typed amount for each.
     */
    draftPayments() {
      const methods = this.draftPayMethods;
      if (methods.length === 1) {
        const [method] = methods;
        if (method !== 'cash') {
          const exact = Math.round(this.draftGrandTotal * 100) / 100;
          return exact > 0 ? [{ method, amount: exact }] : [];
        }
        const raw = this.draft.amountTendered;
        const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
        return Number.isFinite(n) && n > 0 ? [{ method, amount: n }] : [];
      }
      return methods
        .map((method) => ({ method, amount: Number(this.draft.payAmounts?.[method]) || 0 }))
        .filter((p) => p.amount > 0);
    },

    /** POS sale: total handed over across all methods (null until something is entered). */
    draftTendered() {
      const payments = this.draftPayments;
      if (!payments.length) return null;
      return Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    },

    /** Change to give back. Negative means the customer has not handed over enough yet; null until a tender is entered. */
    draftChange() {
      if (this.draftTendered === null) return null;
      return Math.round((this.draftTendered - this.draftGrandTotal) * 100) / 100;
    },

    /** Non-empty when the entered payments cannot be accepted (only cash can give change). */
    draftPayError() {
      const cash = this.draftPayments.find((p) => p.method === 'cash')?.amount || 0;
      const nonCash = (this.draftTendered || 0) - cash;
      if (nonCash > this.draftGrandTotal + 0.005) return 'Card, EFT, mobile money and cheque amounts cannot be more than the total';
      return '';
    },

    /** What the customer actually pays: tax-inclusive gross total minus any header-level discount. */
    draftGrandTotal(state) {
      return this.draftGrossSubtotal - (state.draft.discountTotal || 0);
    },
  },

  actions: {
    // Re-runs the last fetch with the same filters (used when another PC changes data).
    async refresh() {
      if (this._lastFilters === undefined) return;
      await this.fetchAll(this._lastFilters);
    },

    async fetchAll(filters = {}) {
      this._lastFilters = filters;
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
        posMode: tx.type === 'invoice' && tx.amount_tendered !== null && tx.amount_tendered !== undefined,
        ...paymentsToDraft(tx),
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

    /**
     * Adds a free-text line (no product, no search). product_id stays null,
     * which the repositories already support: no stock movement is recorded
     * and the typed name is the snapshot stored on the document.
     */
    addManualItem() {
      const settingsStore = useSettingsStore();
      const fallbackRate = Number(settingsStore.values.default_tax_rate || 0);
      this.draft.lineItems.push({
        product_id: null,
        name: '',
        quantity: 1,
        box_size: null,
        box_count: null,
        unit_price: null, // must be typed in (checked on save unless it's a purchase order)
        discount_pct: 0,
        tax_rate: fallbackRate,
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

      // Manual (product-less) lines need a description, and a price unless
      // this is a purchase order, otherwise they would print blank or be
      // silently left out of the totals.
      this.draft.lineItems.forEach((item, i) => {
        if (item.product_id != null) return;
        item.name = String(item.name || '').trim();
        if (!item.name) throw new Error(`Row ${i + 1}: enter a description for the manual item`);
        const priced = item.unit_price !== null && item.unit_price !== '' && !Number.isNaN(Number(item.unit_price));
        if (type !== 'purchase_order' && !priced) {
          throw new Error(`Row ${i + 1}: enter a price for "${item.name}"`);
        }
      });

      // POS cash sale: the customer must hand over at least the total (no part payments).
      const isPosSale = Boolean(this.draft.posMode) && type === 'invoice' && saveAs === 'invoice';
      if (isPosSale) {
        if (this.draftTendered === null) throw new Error('Enter the tendered amount first');
        if (this.draftChange < 0) throw new Error('The amount paid is less than the total');
        if (this.draftPayError) throw new Error(this.draftPayError);
      }

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
        amountTendered: isPosSale ? this.draftTendered : null,
        payments: isPosSale ? this.draftPayments : [],
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
      // A finished POS sale leaves the screen ready for the next customer, still in POS mode.
      const keepPos = isPosSale && !this.draft.id;
      this.draft = emptyDraft();
      if (keepPos) {
        this.draft.type = 'invoice';
        this.draft.posMode = true;
      }
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
