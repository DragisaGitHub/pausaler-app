export const VIEW_ONLY_ALLOWED: string[] = [
  'Browse invoices/clients/expenses/settings',
  'Open invoice details',
];

export const VIEW_ONLY_BLOCKED: string[] = [
  'Invoice create/update/delete/duplicate',
  'Invoice PDF export',
  'Send invoice email',
  'CSV exports (invoices/expenses)',
  'Client create/update/delete',
  'Expense create/update/delete',
  'Edit company/settings (save)',
];

export const HARD_BLOCKED: string[] = [
  'Everything except License/Setup pages',
];
