import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

import { normalizeInvoiceUnit } from '../types';
import type { Client, Invoice, Settings } from '../types';
import { formatCompanyAddressMultiline } from './companyAddress';

export type InvoicePdfPayload = {
  language: 'sr' | 'en';
  invoice_number: string;
  issue_date: string;
  service_date: string;
  currency: string;
  subtotal: number;
  discount_total: number;
  total: number;
  notes?: string | null;
  company: {
    company_name: string;
    registration_number: string;
    pib: string;
    address: string;
    address_line?: string | null;
    postal_code?: string | null;
    city?: string | null;
    bank_account: string;
    email?: string | null;
    phone?: string | null;
  };
  client: {
    name: string;
    registration_number?: string | null;
    pib?: string | null;
    address?: string | null;
    address_line?: string | null;
    postal_code?: string | null;
    city?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  items: Array<{
    description: string;
    unit?: string | null;
    quantity: number;
    unit_price: number;
    discount_amount?: number | null;
    total: number;
  }>;
};

function clampMoney(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function computeInvoiceTotals(items: Invoice['items']): {
  subtotal: number;
  discountTotal: number;
  total: number;
} {
  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
  const discountTotal = items.reduce((sum, it) => {
    const lineSubtotal = Number(it.quantity) * Number(it.unitPrice);
    const raw = Number(it.discountAmount ?? 0);
    const lineDiscount = clampMoney(raw, 0, lineSubtotal);
    return sum + lineDiscount;
  }, 0);
  const total = subtotal - discountTotal;
  return { subtotal, discountTotal, total };
}

export function buildInvoicePdfPayload(args: {
  invoice: Invoice;
  client?: Client;
  settings: Settings;
}): InvoicePdfPayload {
  const { invoice, client, settings } = args;

  const totals = computeInvoiceTotals(invoice.items);

  return {
    language: settings.language,
    invoice_number: invoice.invoiceNumber,
    issue_date: invoice.issueDate,
    service_date: invoice.serviceDate,
    currency: invoice.currency,
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    total: totals.total,
    notes: invoice.notes ? invoice.notes : null,
    company: {
      company_name: settings.companyName,
      registration_number: settings.registrationNumber,
      pib: settings.pib,
      address: formatCompanyAddressMultiline(settings),
      address_line: settings.companyAddressLine,
      postal_code: settings.companyPostalCode,
      city: settings.companyCity,
      bank_account: settings.bankAccount,
      email: settings.companyEmail?.trim() ? settings.companyEmail.trim() : null,
      phone: settings.companyPhone?.trim() ? settings.companyPhone.trim() : null,
    },
    client: {
      name: invoice.clientName,
      registration_number: client?.registrationNumber ?? null,
      pib: client?.pib ?? null,
      address: client?.address ?? null,
      address_line: client?.address ?? null,
      postal_code: (client as any)?.postalCode ?? null,
      city: (client as any)?.city ?? null,
      email: client?.email ?? null,
      phone: (client as any)?.phone ?? null,
    },
    items: invoice.items.map((it) => ({
      description: it.description,
      unit: normalizeInvoiceUnit((it as any).unit),
      quantity: Number(it.quantity),
      unit_price: Number(it.unitPrice),
      discount_amount: it.discountAmount == null ? null : clampMoney(Number(it.discountAmount), 0, Number(it.quantity) * Number(it.unitPrice)),
      total: Number(it.quantity) * Number(it.unitPrice) - clampMoney(Number(it.discountAmount ?? 0), 0, Number(it.quantity) * Number(it.unitPrice)),
    })),
  };
}

export async function exportInvoicePdfToDownloads(payload: InvoicePdfPayload): Promise<string> {
  return invoke<string>('export_invoice_pdf_to_downloads', { payload });
}

export async function openGeneratedPdf(path: string): Promise<void> {
  await open(path);
}
