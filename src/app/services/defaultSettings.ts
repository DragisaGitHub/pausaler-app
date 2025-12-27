import type { Settings } from '../types';

export const defaultSettings: Settings = {
  isConfigured: false,
  companyName: '',
  pib: '',
  address: '',
  bankAccount: '',
  logoUrl: '',
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
  defaultCurrency: 'RSD',
  language: 'sr',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  smtpUseTls: true,
};
