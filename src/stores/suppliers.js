import { defineStore } from 'pinia';
import SupplierRepository from 'src/services/repositories/SupplierRepository';

export const useSuppliersStore = defineStore('suppliers', {
    state: () => ({ items: [], loading: false, error: null }),
    getters: { byId: (state) => (id) => state.items.find((supplier) => supplier.id === id) },
    actions: {
        async fetchAll(filters = {}) {
            this.loading = true;
            try { this.items = await SupplierRepository.all(filters); }
            catch (err) { this.error = err.message; throw err; }
            finally { this.loading = false; }
        },
        async create(data) { const created = await SupplierRepository.create(data); this.items.push(created); return created; },
        async update(id, data) {
            const updated = await SupplierRepository.update(id, data);
            const index = this.items.findIndex((supplier) => supplier.id === id);
            if (index !== -1) this.items[index] = updated;
            return updated;
        },
        async remove(id) { await SupplierRepository.delete(id); this.items = this.items.filter((supplier) => supplier.id !== id); },
    },
});