import { invoke } from '@tauri-apps/api/core';

import type { StorageAdapter } from './storageAdapter';
import type { Client, Invoice, Settings } from '../types';

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
    getAllInvoices: async (): Promise<Invoice[]> => invokeLogged<Invoice[]>('getAllInvoices', 'get_all_invoices'),

    getInvoiceById: async (id: string): Promise<Invoice | undefined> => {
      const res = await invokeLogged<Invoice | null>('getInvoiceById', 'get_invoice_by_id', { id });
      return res ?? undefined;
    },

    createInvoice: async (data: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => {
      // Invoice number is generated atomically on the Rust side inside a single transaction.
      // We ignore any invoiceNumber coming from the UI.
      const { invoiceNumber: _ignored, paidAt: _paidAtIgnored, ...rest } = data as Invoice;
      const input = rest as unknown as NewInvoice;
      return invokeLogged<Invoice>('createInvoice', 'create_invoice', { input });
    },

    updateInvoice: async (id: string, patch: Partial<Invoice>): Promise<Invoice | null> => {
      const res = await invokeLogged<Invoice | null>('updateInvoice', 'update_invoice', { id, patch });
      return res ?? null;
    },

    deleteInvoice: async (id: string): Promise<boolean> =>
      invokeLogged<boolean>('deleteInvoice', 'delete_invoice', { id }),

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
