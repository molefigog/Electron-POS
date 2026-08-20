const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/transactions' },
      { path: 'dashboard', name: 'dashboard', component: () => import('pages/DashboardPage.vue') },
      { path: 'transactions', name: 'transactions', component: () => import('pages/TransactionsPage.vue') },
      { path: 'letters', name: 'letters', component: () => import('pages/LetterPage.vue') },
      { path: 'products', name: 'products', component: () => import('pages/ProductsPage.vue') },
      { path: 'customers', name: 'customers', component: () => import('pages/CustomersPage.vue') },
      { path: 'stock', name: 'stock', component: () => import('pages/StockPage.vue') },
      { path: 'reports', name: 'reports', component: () => import('pages/ReportsPage.vue') },
      { path: 'help', name: 'help', component: () => import('pages/HelpPage.vue') },
      { path: 'settings', name: 'settings', component: () => import('pages/SettingsPage.vue') },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
