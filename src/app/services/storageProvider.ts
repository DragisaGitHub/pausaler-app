import { clientService, invoiceService, settingsService } from './storage';
import { createStoreStorageAdapter } from './storeStorageAdapter';
import { createSqliteStorageAdapter } from './sqliteStorageAdapter';
import type { StorageAdapter } from './storageAdapter';
import type { Client, Invoice, Settings } from '../types';

let singleton: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (singleton) return singleton;

  const requested = String(import.meta.env.VITE_STORAGE ?? '').toLowerCase();
  const isTauri = typeof window !== 'undefined' && typeof (window as any).__TAURI__ !== 'undefined';

  // Prefer the new default storage selector.
  // - 'sqlite' (default for Tauri)
  // - 'store' (legacy)
  if (isTauri) {
    if (requested === 'store' || String(import.meta.env.VITE_USE_TAURI_STORE) === 'true') {
      singleton = createStoreStorageAdapter();
      return singleton;
    }

    // Default to sqlite for Tauri runs.
    singleton = createSqliteStorageAdapter();
    return singleton;
  }

  // Browser/dev fallback.
  if (requested === 'store') {
    singleton = createStoreStorageAdapter();
    return singleton;
  }

  singleton = {
    // Settings
    getSettings: async (): Promise<Settings> => settingsService.get(),
    updateSettings: async (patch: Partial<Settings>): Promise<Settings> => settingsService.update(patch),
    generateInvoiceNumber: async (): Promise<string> => settingsService.generateInvoiceNumber(),

    // Clients
    getAllClients: async (): Promise<Client[]> => clientService.getAll(),
    getClientById: async (id: string): Promise<Client | undefined> => clientService.getById(id),
    createClient: async (data: Omit<Client, 'id' | 'createdAt'>): Promise<Client> => clientService.create(data),
    updateClient: async (id: string, patch: Partial<Client>): Promise<Client | null> => clientService.update(id, patch),
    deleteClient: async (id: string): Promise<boolean> => clientService.delete(id),

    // Invoices
    getAllInvoices: async (): Promise<Invoice[]> => invoiceService.getAll(),
    getInvoiceById: async (id: string): Promise<Invoice | undefined> => invoiceService.getById(id),
    createInvoice: async (data: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => invoiceService.create(data),
    updateInvoice: async (id: string, patch: Partial<Invoice>): Promise<Invoice | null> => invoiceService.update(id, patch),
    deleteInvoice: async (id: string): Promise<boolean> => invoiceService.delete(id),
  };

  return singleton;
}
