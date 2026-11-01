export const E_INVOICE_PROVIDER_NONE = 'none'

export const LEKUKA_INTEGRATION = Object.freeze({
  id: 'lekuka',
  name: 'Lekuka',
  authority: 'Revenue Services Lesotho',
  environments: Object.freeze({
    testing: 'https://lekukaapi.rsl.org.ls:8443',
    production: 'https://lekukaapi.rsl.org.ls',
  }),
})

export const E_INVOICE_PROVIDER_OPTIONS = [
  { label: 'No e-invoicing integration', value: E_INVOICE_PROVIDER_NONE },
  { label: `${LEKUKA_INTEGRATION.name} (${LEKUKA_INTEGRATION.authority})`, value: LEKUKA_INTEGRATION.id },
]
