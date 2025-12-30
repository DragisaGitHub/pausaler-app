import { invoke } from '@tauri-apps/api/core';

import type { StorageAdapter } from './storageAdapter';
import { normalizeInvoiceUnit } from '../types';
import type { Client, Expense, ExpenseRange, Invoice, Settings } from '../types';

type NewInvoice = {
  clientId: string;
  clientName: string;
  issueDate: string;
  serviceDate: string;
  status?: Invoice['status'];
  dueDate?: Invoice['dueDate'];
  currency: string;
  items: Invoice['items'];
  subtotal: number;
  total: number;
  notes: string;
};

function normalizeInvoiceUnits(invoice: Invoice): Invoice {
  return {
    ...invoice,
    items: (invoice.items ?? []).map((it: any) => ({
      ...it,
      unit: normalizeInvoiceUnit(it?.unit),
    })),
  };
}

function normalizeInvoicePatchUnits(patch: Partial<Invoice>): Partial<Invoice> {
  if (!('items' in patch) || !patch.items) return patch;
  return {
    ...patch,
    items: (patch.items as any[]).map((it: any) => ({
      ...it,
      unit: normalizeInvoiceUnit(it?.unit),
    })) as any,
  };
}

function logSqlError(context: string, err: unknown): void {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.sqliteCode ?? anyErr?.errno;
  const message = anyErr?.message ?? String(err);
  console.error('[sqlite]', { context, code, message });
}

async function invokeLogged<T>(context: string, cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    logSqlError(context, e);
    throw e;
  }
}

export function createSqliteStorageAdapter(): StorageAdapter {
  return {
    // Settings
    getSettings: async (): Promise<Settings> => invokeLogged<Settings>('getSettings', 'get_settings'),

    updateSettings: async (patch: Partial<Settings>): Promise<Settings> =>
      invokeLogged<Settings>('updateSettings', 'update_settings', { patch }),

    generateInvoiceNumber: async (): Promise<string> =>
      invokeLogged<string>('generateInvoiceNumber', 'generate_invoice_number'),

    previewNextInvoiceNumber: async (): Promise<string> =>
      invokeLogged<string>('previewNextInvoiceNumber', 'preview_next_invoice_number'),

    // Clients
    getAllClients: async (): Promise<Client[]> => invokeLogged<Client[]>('getAllClients', 'get_all_clients'),

    getClientById: async (id: string): Promise<Client | undefined> => {
      const res = await invokeLogged<Client | null>('getClientById', 'get_client_by_id', { id });
      return res ?? undefined;
    },

    createClient: async (data: Omit<Client, 'id' | 'createdAt'>): Promise<Client> =>
      invokeLogged<Client>('createClient', 'create_client', { input: data }),

    updateClient: async (id: string, patch: Partial<Client>): Promise<Client | null> => {
      const res = await invokeLogged<Client | null>('updateClient', 'update_client', { id, patch });
      return res ?? null;
    },

    deleteClient: async (id: string): Promise<boolean> =>
      invokeLogged<boolean>('deleteClient', 'delete_client', { id }),

    // Invoices
    getAllInvoices: async (): Promise<Invoice[]> => {
      const res = await invokeLogged<Invoice[]>('getAllInvoices', 'get_all_invoices');
      return res.map(normalizeInvoiceUnits);
    },

    listInvoicesRange: async (from: string, to: string): Promise<Invoice[]> => {
      const res = await invokeLogged<Invoice[]>('listInvoicesRange', 'list_invoices_range', { from, to });
      return res.map(normalizeInvoiceUnits);
    },

    getInvoiceById: async (id: string): Promise<Invoice | undefined> => {
      const res = await invokeLogged<Invoice | null>('getInvoiceById', 'get_invoice_by_id', { id });
      return res ? normalizeInvoiceUnits(res) : undefined;
    },

    createInvoice: async (data: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => {
      // Invoice number is generated atomically on the Rust side inside a single transaction.
      // We ignore any invoiceNumber coming from the UI.
      const { invoiceNumber: _ignored, paidAt: _paidAtIgnored, ...rest } = data as Invoice;
      const normalized = normalizeInvoiceUnits(rest as unknown as Invoice);
      const input = normalized as unknown as NewInvoice;
      const created = await invokeLogged<Invoice>('createInvoice', 'create_invoice', { input });
      return normalizeInvoiceUnits(created);
    },

    updateInvoice: async (id: string, patch: Partial<Invoice>): Promise<Invoice | null> => {
      const normalizedPatch = normalizeInvoicePatchUnits(patch);
      const res = await invokeLogged<Invoice | null>('updateInvoice', 'update_invoice', { id, patch: normalizedPatch });
      return res ? normalizeInvoiceUnits(res) : null;
    },

    deleteInvoice: async (id: string): Promise<boolean> =>
      invokeLogged<boolean>('deleteInvoice', 'delete_invoice', { id }),

    // Expenses
    listExpenses: async (range?: ExpenseRange): Promise<Expense[]> =>
      invokeLogged<Expense[]>('listExpenses', 'list_expenses', { range: range ?? null }),

    createExpense: async (data: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> =>
      invokeLogged<Expense>('createExpense', 'create_expense', { input: data }),

    updateExpense: async (id: string, patch: Partial<Omit<Expense, 'id' | 'createdAt'>>): Promise<Expense | null> => {
      const res = await invokeLogged<Expense | null>('updateExpense', 'update_expense', { id, patch });
      return res ?? null;
    },

    deleteExpense: async (id: string): Promise<boolean> =>
      invokeLogged<boolean>('deleteExpense', 'delete_expense', { id }),

    // Exports
    exportInvoicesCsv: async (from: string, to: string, outputPath: string): Promise<string> =>
      invokeLogged<string>('exportInvoicesCsv', 'export_invoices_csv', { from, to, outputPath }),

    exportExpensesCsv: async (from: string, to: string, outputPath: string): Promise<string> =>
      invokeLogged<string>('exportExpensesCsv', 'export_expenses_csv', { from, to, outputPath }),

    // Email
    sendInvoiceEmail: async (input: {
      invoiceId: string;
      to: string;
      subject: string;
      body?: string;
      includePdf: boolean;
    }): Promise<boolean> => invokeLogged<boolean>('sendInvoiceEmail', 'send_invoice_email', { input }),
  };
}
