export interface Client {
  id: string;
  name: string;
  pib: string;
  address: string;
  email: string;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  serviceDate: string;
  currency: string;
  items: InvoiceItem[];
  subtotal: number;
  total: number;
  notes: string;
  createdAt: string;
}

export interface Settings {
  /**
   * Explicit onboarding marker. When false (or missing), the app may require the user
   * to complete initial setup before using the main flows.
   */
  isConfigured?: boolean;
  companyName: string;
  pib: string;
  address: string;
  bankAccount: string;
  logoUrl: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  defaultCurrency: string;
  language: 'sr' | 'en';
}

export const CURRENCY_VALUES = ['RSD', 'EUR', 'USD'] as const;
export type CurrencyCode = (typeof CURRENCY_VALUES)[number];
