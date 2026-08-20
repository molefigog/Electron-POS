import { defineStore } from 'pinia';
import ProductRepository from 'src/services/repositories/ProductRepository';

export const useProductsStore = defineStore('products', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
  }),

  getters: {
    lowStock: (state) => state.items.filter((p) => p.stock_qty <= p.reorder_level),
    byId: (state) => (id) => state.items.find((p) => p.id === id),
  },

  actions: {
    async fetchAll(filters = {}) {
      this.loading = true;
      this.error = null;
      try {
        this.items = await ProductRepository.all(filters);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async findByBarcode(barcode) {
      // check local cache first, fall back to DB
      return this.items.find((p) => p.barcode === barcode) || (await ProductRepository.findByBarcode(barcode));
    },

    async create(data) {
      const created = await ProductRepository.create(data);
      this.items.push(created);
      return created;
    },

    async update(id, data) {
      const updated = await ProductRepository.update(id, data);
      const idx = this.items.findIndex((p) => p.id === id);
      if (idx !== -1) this.items[idx] = updated;
      return updated;
    },

    async remove(id) {
      await ProductRepository.delete(id);
      this.items = this.items.filter((p) => p.id !== id);
    },

    /** Call after any stock movement so cached qty stays correct without a full refetch */
    patchStockQty(productId, newQty) {
      const product = this.items.find((p) => p.id === productId);
      if (product) product.stock_qty = newQty;
    },
  },
});
