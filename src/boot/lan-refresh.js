import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { useProductsStore } from 'src/stores/products'
import { useCustomersStore } from 'src/stores/customers'
import { useSuppliersStore } from 'src/stores/suppliers'
import { useTransactionsStore } from 'src/stores/transactions'

// When another PC changes data, re-load the lists this PC has already opened
// (using the same filters as before) so prices, stock and quotations stay current.
export default boot(() => {
  const bridge = window.networkBridge
  if (!bridge?.onChanged) return

  let timer = null
  const refresh = () => {
    for (const useStore of [useProductsStore, useCustomersStore, useSuppliersStore, useTransactionsStore]) {
      useStore().refresh?.().catch(() => {})
    }
  }
  bridge.onChanged(() => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 800) // several quick changes become one refresh
  })

  // Tell the cashier when this PC loses / regains the main PC.
  let dismissOffline = null
  let wasConnected = null
  bridge.onStatus?.((connected) => {
    if (!connected && wasConnected !== false) {
      dismissOffline = Notify.create({
        type: 'negative', message: 'Lost connection to the main PC. Trying to reconnect...', timeout: 0, group: 'lan-offline',
      })
    } else if (connected) {
      dismissOffline?.()
      dismissOffline = null
      if (wasConnected === false) {
        Notify.create({ type: 'positive', message: 'Reconnected to the main PC.' })
        refresh()
      }
    }
    wasConnected = connected
  })
})
