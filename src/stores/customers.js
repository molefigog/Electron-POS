import { defineStore } from 'pinia';
import CustomerRepository from 'src/services/repositories/CustomerRepository';

export const useCustomersStore = defineStore('customers', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
  }),

  getters: {
    byId: (state) => (id) => state.items.find((c) => c.id === id),
  },

  actions: {
    async fetchAll(filters = {}) {
      this.loading = true;
      this.error = null;
      try {
        this.items = await CustomerRepository.all(filters);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async create(data) {
      const created = await CustomerRepository.create(data);
      this.items.push(created);
      return created;
    },

    async update(id, data) {
      const updated = await CustomerRepository.update(id, data);
      const idx = this.items.findIndex((c) => c.id === id);
      if (idx !== -1) this.items[idx] = updated;
      return updated;
    },

    async remove(id) {
      await CustomerRepository.delete(id);
      this.items = this.items.filter((c) => c.id !== id);
    },
  },
});
