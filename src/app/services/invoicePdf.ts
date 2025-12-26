import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

import type { Client, Invoice, Settings } from '../types';

export type InvoicePdfPayload = {
  language: 'sr' | 'en';
  invoice_number: string;
  issue_date: string;
  service_date: string;
  currency: string;
  subtotal: number;
  total: number;
  notes?: string | null;
  company: {
    company_name: string;
    pib: string;
    address: string;
    bank_account: string;
  };
  client: {
    name: string;
    pib?: string | null;
    address?: string | null;
    email?: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
};

export function buildInvoicePdfPayload(args: {
  invoice: Invoice;
  client?: Client;
  settings: Settings;
}): InvoicePdfPayload {
  const { invoice, client, settings } = args;

  return {
    language: settings.language,
    invoice_number: invoice.invoiceNumber,
    issue_date: invoice.issueDate,
    service_date: invoice.serviceDate,
    currency: invoice.currency,
    subtotal: invoice.subtotal ?? invoice.total,
    total: invoice.total,
    notes: invoice.notes ? invoice.notes : null,
    company: {
      company_name: settings.companyName,
      pib: settings.pib,
      address: settings.address,
      bank_account: settings.bankAccount,
    },
    client: {
      name: invoice.clientName,
      pib: client?.pib ?? null,
      address: client?.address ?? null,
      email: client?.email ?? null,
    },
    items: invoice.items.map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unitPrice),
      total: Number(it.total),
    })),
  };
}

export async function exportInvoicePdfToDownloads(payload: InvoicePdfPayload): Promise<string> {
  return invoke<string>('export_invoice_pdf_to_downloads', { payload });
}

export async function openGeneratedPdf(path: string): Promise<void> {
  await open(path);
}
