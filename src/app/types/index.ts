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

export const INVOICE_STATUS_VALUES = ['DRAFT', 'SENT', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  serviceDate: string;
  status: InvoiceStatus;
  dueDate?: string | null;
  paidAt?: string | null;
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

  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpUseTls: boolean;
  smtpTlsMode: 'implicit' | 'starttls';
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  /** YYYY-MM-DD */
  date: string;
  category?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ExpenseRange {
  from?: string;
  to?: string;
}

export const CURRENCY_VALUES = ['RSD', 'EUR', 'USD'] as const;
export type CurrencyCode = (typeof CURRENCY_VALUES)[number];
