import type { Settings } from '../types';

export const defaultSettings: Settings = {
  isConfigured: false,
  companyName: '',
  registrationNumber: '',
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
  smtpTlsMode: 'starttls',
};
