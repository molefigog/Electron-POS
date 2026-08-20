import { defineStore } from 'pinia';
import StockRepository from 'src/services/repositories/StockRepository';
import { useProductsStore } from './products';

export const useStockStore = defineStore('stock', {
  state: () => ({
    history: [],
    loading: false,
  }),

  actions: {
    async fetchHistory(productId) {
      this.loading = true;
      try {
        this.history = await StockRepository.history(productId);
      } finally {
        this.loading = false;
      }
    },

    /** type: 'in' | 'out' | 'adjustment' */
    async record({ productId, type, quantity, reason }) {
      const updatedProduct = await StockRepository.record({ productId, type, quantity, reason });
      const productsStore = useProductsStore();
      productsStore.patchStockQty(productId, updatedProduct.stock_qty);
      if (this.history.length && this.history[0].product_id === productId) {
        await this.fetchHistory(productId);
      }
      return updatedProduct;
    },
  },
});
