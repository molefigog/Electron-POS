<template>
  <q-page class="q-pa-md help-page">
    <div class="text-h5 q-mb-sm">Help</div>
    <div class="text-subtitle2 text-grey-7 q-mb-md">How to use this POS and how to request new features.</div>

    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 text-weight-medium q-mb-sm">How To Use This POS (Step-by-Step)</div>
        <ol class="help-list">
          <li>Start the app and open Dashboard to confirm data loads.</li>
          <li>Open Settings and set business information (company name, phone, email, address, VAT, currency,
            print template).</li>
          <li>Add products in Products: name, SKU/barcode, selling price, and stock-related details.</li>
          <li>Add customers in Customers or create customers while making a transaction.</li>
          <li>
            Create a transaction in Transactions:
            <ul>
              <li>Choose document type (Quotation, Invoice, or Purchase Order).</li>
              <li>Select customer (or leave blank for walk-in).</li>
              <li>Add products by search, SKU, or barcode scan.</li>
              <li>Edit quantity, price, discount, and tax as needed.</li>
              <li>Save the document.</li>
            </ul>
          </li>
          <li>Print or export PDF from the transaction using the selected print template.</li>
          <li>Use Stock to monitor item levels and updates.</li>
          <li>Use Reports to filter by date range, review totals, print report, or export report PDF.</li>
          <li>Use Business Letter page to create and print branded letters when needed.</li>
        </ol>
      </q-card-section>
    </q-card>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium q-mb-sm">Current Status</div>
            <ul class="help-list">
              <li>Authentication is not enabled yet in the current version.</li>
              <li>Upcoming versions will include authentication.</li>
              <li>Upcoming versions will include backup saving.</li>
              <li>Upcoming versions will include sync to Laravel.</li>
            </ul>
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium q-mb-sm">New Version / Feature Requests</div>
            <ul class="help-list">
              <li><strong>Contact person:</strong>Elliot</li>
              <li><strong>Contact:</strong> +266 59073443</li>
              <li><strong>Email:</strong> molefigw@gmail.com</li>
              <li>
                <strong>Website:</strong>
                <a href="https://www.gw-ent.co.za" target="_blank" rel="noopener">https://www.gw-ent.co.za</a>
              </li>
            </ul>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.help-page {
  max-width: 1200px;
}

.help-list {
  margin: 0;
  padding-left: 20px;
  line-height: 1.6;
}

.help-list li+li {
  margin-top: 6px;
}
</style>