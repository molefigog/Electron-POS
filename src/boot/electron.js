import { boot } from 'quasar/wrappers'
import { Dialog } from 'quasar'
import packageInfo from '../../package.json'

export default boot(({ router }) => {
  if (window.dbBridge) {
    window.dbBridge.onNavigate((route) => {
      console.log('Electron navigation:', route)
      router.push(route)
    })

    window.dbBridge.onAbout(async () => {
      const settings = await window.dbBridge.call('settings', 'all').catch(() => ({}))

      const companyName = String(settings?.company_name || 'My Company').trim() || 'My Company'
      const packageVersion = String(packageInfo?.version || '').trim()
      const packageDescription = String(packageInfo?.description || '').trim()
      const versionLine = packageVersion ? `<div class="q-mt-xs">Version ${packageVersion}</div>` : ''
      const descriptionLine = packageDescription ? `<div class="q-mt-xs text-grey-7">${packageDescription}</div>` : ''

      Dialog.create({
        title: `About ${companyName}`,
        html: true,
        message: `<div><strong>${companyName}</strong>${versionLine}${descriptionLine}</div>`,
        ok: {
          label: 'Close',
          color: 'primary',
        },
        cancel: {
          label: 'More Info',
          flat: true,
        },
      }).onCancel(() => {
        router.push('/help')
      })
    })
  }
})
