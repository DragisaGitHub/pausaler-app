import { Client, Invoice, Settings } from '../types';

const STORAGE_KEYS = {
  CLIENTS: 'invoicing_clients',
  INVOICES: 'invoicing_invoices',
  SETTINGS: 'invoicing_settings',
};

// Helper functions for localStorage
export const storage = {
  get: <T>(key: string): T | null => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return null;
    }
  },
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error writing to localStorage:', error);
    }
  },
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing from localStorage:', error);
    }
  },
};

// Default settings
const defaultSettings: Settings = {
  companyName: 'Moja Firma DOO',
  pib: '123456789',
  address: 'Bulevar kralja Aleksandra 1, Beograd',
  bankAccount: '160-5100000000000-00',
  logoUrl: '',
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
  defaultCurrency: 'RSD',
  language: 'sr',
};

// Initialize default settings if not exists
export const initializeSettings = (): void => {
  const settings = storage.get<Settings>(STORAGE_KEYS.SETTINGS);
  if (!settings) {
    storage.set(STORAGE_KEYS.SETTINGS, defaultSettings);
  }
};

// Client services
export const clientService = {
  getAll: (): Client[] => {
    return storage.get<Client[]>(STORAGE_KEYS.CLIENTS) || [];
  },
  getById: (id: string): Client | undefined => {
    const clients = clientService.getAll();
    return clients.find((c) => c.id === id);
  },
  create: (client: Omit<Client, 'id' | 'createdAt'>): Client => {
    const clients = clientService.getAll();
    const newClient: Client = {
      ...client,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    storage.set(STORAGE_KEYS.CLIENTS, [...clients, newClient]);
    return newClient;
  },
  update: (id: string, client: Partial<Client>): Client | null => {
    const clients = clientService.getAll();
    const index = clients.findIndex((c) => c.id === id);
    if (index === -1) return null;
    
    const updated = { ...clients[index], ...client };
    clients[index] = updated;
    storage.set(STORAGE_KEYS.CLIENTS, clients);
    return updated;
  },
  delete: (id: string): boolean => {
    const clients = clientService.getAll();
    const filtered = clients.filter((c) => c.id !== id);
    if (filtered.length === clients.length) return false;
    
    storage.set(STORAGE_KEYS.CLIENTS, filtered);
    return true;
  },
};

// Invoice services
export const invoiceService = {
  getAll: (): Invoice[] => {
    return storage.get<Invoice[]>(STORAGE_KEYS.INVOICES) || [];
  },
  getById: (id: string): Invoice | undefined => {
    const invoices = invoiceService.getAll();
    return invoices.find((i) => i.id === id);
  },
  create: (invoice: Omit<Invoice, 'id' | 'createdAt'>): Invoice => {
    const invoices = invoiceService.getAll();
    const newInvoice: Invoice = {
      ...invoice,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    storage.set(STORAGE_KEYS.INVOICES, [...invoices, newInvoice]);
    
    // Increment next invoice number in settings
    const settings = settingsService.get();
    settingsService.update({ nextInvoiceNumber: settings.nextInvoiceNumber + 1 });
    
    return newInvoice;
  },
  update: (id: string, invoice: Partial<Invoice>): Invoice | null => {
    const invoices = invoiceService.getAll();
    const index = invoices.findIndex((i) => i.id === id);
    if (index === -1) return null;
    
    const updated = { ...invoices[index], ...invoice };
    invoices[index] = updated;
    storage.set(STORAGE_KEYS.INVOICES, invoices);
    return updated;
  },
  delete: (id: string): boolean => {
    const invoices = invoiceService.getAll();
    const filtered = invoices.filter((i) => i.id !== id);
    if (filtered.length === invoices.length) return false;
    
    storage.set(STORAGE_KEYS.INVOICES, filtered);
    return true;
  },
};

// Settings services
export const settingsService = {
  get: (): Settings => {
    const saved = storage.get<Partial<Settings>>(STORAGE_KEYS.SETTINGS) || {};
    return { ...defaultSettings, ...saved } as Settings;
  },
  update: (settings: Partial<Settings>): Settings => {
    const current = settingsService.get();
    const updated = { ...current, ...settings };
    storage.set(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  },
  generateInvoiceNumber: (): string => {
    const settings = settingsService.get();
    return `${settings.invoicePrefix}-${settings.nextInvoiceNumber.toString().padStart(4, '0')}`;
  },
};

export const resetInvoicingStorage = (): void => {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
  initializeSettings();
};

// Initialize on load
initializeSettings();
