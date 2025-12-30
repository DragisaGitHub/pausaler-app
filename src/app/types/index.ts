export interface Client {
  id: string;
  name: string;
  registrationNumber: string;
  pib: string;
  /** Street + number (legacy field name kept for backward compatibility). */
  address: string;
  city: string;
  postalCode: string;
  email: string;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  unit: InvoiceUnit;
  quantity: number;
  unitPrice: number;
  /** Optional per-line absolute discount amount in invoice currency. */
  discountAmount?: number;
  total: number;
}

export const INVOICE_UNIT_VALUES = ['kom', 'sat', 'm2', 'usluga'] as const;
export type InvoiceUnit = (typeof INVOICE_UNIT_VALUES)[number];

export function isInvoiceUnit(value: unknown): value is InvoiceUnit {
  return (
    typeof value === 'string' &&
    (INVOICE_UNIT_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeInvoiceUnit(value: unknown): InvoiceUnit {
  if (typeof value !== 'string') return 'kom';
  const s = value.trim().toLowerCase();
  if (!s) return 'kom';
  if (s === 'm2' || s === 'm²' || s === 'm^2') return 'm2';
  if (s === 'kom') return 'kom';
  if (s === 'sat' || s === 'h') return 'sat';
  if (s === 'usluga') return 'usluga';
  return 'usluga';
}

export function invoiceUnitLabel(unit: InvoiceUnit): string {
  return unit === 'm2' ? 'm²' : unit;
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
  registrationNumber: string;
  pib: string;
  companyAddressLine: string;
  companyCity: string;
  companyPostalCode: string;
  companyEmail: string;
  companyPhone: string;
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
