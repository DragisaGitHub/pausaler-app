import type { StorageAdapter } from './storageAdapter';
import type { Client, Invoice, Settings } from '../types';
import { defaultSettings } from './storage';

const STORE_FILE = 'pausaler.store.json';
const SCHEMA_VERSION = 1;

const KEYS = {
  schemaVersion: 'schemaVersion',
  settings: 'settings',
  clients: 'clients',
  invoices: 'invoices',
  migratedFromLocalStorageAt: 'migratedFromLocalStorageAt',
} as const;

type StoreShape = {
  schemaVersion: number;
  settings: Settings;
  clients: Client[];
  invoices: Invoice[];
};

const LEGACY_LOCALSTORAGE_KEYS = {
  clients: 'invoicing_clients',
  invoices: 'invoicing_invoices',
  settings: 'invoicing_settings',
} as const;

function isUsingTauriStore(): boolean {
  return String(import.meta.env?.VITE_USE_TAURI_STORE) === 'true';
}

function safeParseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

type StoreLike = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;

async function getStore(): Promise<StoreLike> {
  if (storePromise) return storePromise;

  storePromise = (async () => {
    const mod = await import('@tauri-apps/plugin-store');
    const store = (await mod.Store.load(STORE_FILE)) as unknown as StoreLike;
    await ensureInitialized(store);
    return store;
  })();

  return storePromise;
}

function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const merged = { ...defaultSettings, ...(saved || {}) } as Settings;
  if (typeof merged.isConfigured !== 'boolean') {
    const companyName = String(merged.companyName ?? '').trim();
    const pib = String(merged.pib ?? '').trim();
    merged.isConfigured = companyName.length > 0 && pib.length > 0;
  }
  return merged;
}

function shallowEqualRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

async function ensureInitialized(store: StoreLike): Promise<void> {
  // One-time migration from legacy localStorage (web) to tauri-plugin-store.
  // Runs only when the app is configured to use the Tauri store.
  const migrationMarker = (await store.get(KEYS.migratedFromLocalStorageAt)) as string | null;

  const existingSchema = (await store.get(KEYS.schemaVersion)) as number | null;
  const existingSettingsRaw = (await store.get(KEYS.settings)) as unknown;
  const existingSettings =
    existingSettingsRaw && typeof existingSettingsRaw === 'object'
      ? (existingSettingsRaw as Record<string, unknown>)
      : null;
  const existingClients = (await store.get(KEYS.clients)) as Client[] | null;
  const existingInvoices = (await store.get(KEYS.invoices)) as Invoice[] | null;

  let dirty = false;

  if (existingSchema !== SCHEMA_VERSION) {
    await store.set(KEYS.schemaVersion, SCHEMA_VERSION);
    dirty = true;
  }

  if (!existingSettings) {
    await store.set(KEYS.settings, defaultSettings);
    dirty = true;
  } else {
    const merged = mergeSettings(existingSettings as Partial<Settings>);
    const shouldWriteBack = !shallowEqualRecord(existingSettings, merged as unknown as Record<string, unknown>);
    if (shouldWriteBack) {
      await store.set(KEYS.settings, merged);
      dirty = true;
    }
  }

  if (!existingClients) {
    await store.set(KEYS.clients, [] satisfies Client[]);
    dirty = true;
  }

  if (!existingInvoices) {
    await store.set(KEYS.invoices, [] satisfies Invoice[]);
    dirty = true;
  }

  if (isUsingTauriStore() && !migrationMarker) {
    const clientsForCheck = Array.isArray(existingClients) ? existingClients : [];
    const invoicesForCheck = Array.isArray(existingInvoices) ? existingInvoices : [];

    // If the store already has meaningful data, mark migration as completed and stop.
    if (clientsForCheck.length > 0 || invoicesForCheck.length > 0) {
      await store.set(KEYS.migratedFromLocalStorageAt, new Date().toISOString());
      dirty = true;
    } else if (typeof localStorage !== 'undefined') {
      const legacyClientsRaw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.clients);
      const legacyInvoicesRaw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.invoices);
      const legacySettingsRaw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.settings);

      try {
        const legacyClientsParsed = legacyClientsRaw ? safeParseJson(legacyClientsRaw) : null;
        const legacyInvoicesParsed = legacyInvoicesRaw ? safeParseJson(legacyInvoicesRaw) : null;
        const legacySettingsParsed = legacySettingsRaw ? safeParseJson(legacySettingsRaw) : null;

        const migratedClients = Array.isArray(legacyClientsParsed) ? (legacyClientsParsed as Client[]) : [];
        const migratedInvoices = Array.isArray(legacyInvoicesParsed) ? (legacyInvoicesParsed as Invoice[]) : [];
        const migratedSettingsObj =
          legacySettingsParsed && typeof legacySettingsParsed === 'object'
            ? (legacySettingsParsed as Partial<Settings>)
            : null;
        const migratedSettings = mergeSettings(migratedSettingsObj);

        // Write everything in one save (do not clear localStorage for rollback safety).
        await store.set(KEYS.schemaVersion, SCHEMA_VERSION);
        await store.set(KEYS.settings, migratedSettings);
        await store.set(KEYS.clients, migratedClients);
        await store.set(KEYS.invoices, migratedInvoices);
        await store.set(KEYS.migratedFromLocalStorageAt, new Date().toISOString());
        dirty = true;
      } catch {
        // Parse failure: do not migrate and do not set the marker.
      }
    }
  }

  if (dirty) {
    await store.save();
  }
}

async function readAll(store: StoreLike): Promise<StoreShape> {
  const schemaVersion = ((await store.get(KEYS.schemaVersion)) as number | null) ?? SCHEMA_VERSION;
  const settingsRaw = (await store.get(KEYS.settings)) as Partial<Settings> | null;
  const settings = mergeSettings(settingsRaw);
  const clients = ((await store.get(KEYS.clients)) as Client[] | null) ?? [];
  const invoices = ((await store.get(KEYS.invoices)) as Invoice[] | null) ?? [];

  return { schemaVersion, settings, clients, invoices };
}

export function createStoreStorageAdapter(): StorageAdapter {
  return {
    // Settings
    getSettings: async (): Promise<Settings> => {
      const store = await getStore();
      const data = await readAll(store);
      return data.settings;
    },

    updateSettings: async (patch: Partial<Settings>): Promise<Settings> => {
      const store = await getStore();
      const data = await readAll(store);
      const updated = { ...data.settings, ...patch } as Settings;
      await store.set(KEYS.settings, updated);
      await store.save();
      return updated;
    },

    generateInvoiceNumber: async (): Promise<string> => {
      const store = await getStore();
      const data = await readAll(store);
      return `${data.settings.invoicePrefix}-${data.settings.nextInvoiceNumber.toString().padStart(4, '0')}`;
    },

    // Clients
    getAllClients: async (): Promise<Client[]> => {
      const store = await getStore();
      const data = await readAll(store);
      return data.clients;
    },

    getClientById: async (id: string): Promise<Client | undefined> => {
      const store = await getStore();
      const data = await readAll(store);
      return data.clients.find((c) => c.id === id);
    },

    createClient: async (input: Omit<Client, 'id' | 'createdAt'>): Promise<Client> => {
      const store = await getStore();
      const data = await readAll(store);

      const created: Client = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };

      await store.set(KEYS.clients, [...data.clients, created]);
      await store.save();
      return created;
    },

    updateClient: async (id: string, patch: Partial<Client>): Promise<Client | null> => {
      const store = await getStore();
      const data = await readAll(store);
      const index = data.clients.findIndex((c) => c.id === id);
      if (index === -1) return null;

      const updated = { ...data.clients[index], ...patch } as Client;
      const next = [...data.clients];
      next[index] = updated;

      await store.set(KEYS.clients, next);
      await store.save();
      return updated;
    },

    deleteClient: async (id: string): Promise<boolean> => {
      const store = await getStore();
      const data = await readAll(store);
      const next = data.clients.filter((c) => c.id !== id);
      if (next.length === data.clients.length) return false;

      await store.set(KEYS.clients, next);
      await store.save();
      return true;
    },

    // Invoices
    getAllInvoices: async (): Promise<Invoice[]> => {
      const store = await getStore();
      const data = await readAll(store);
      return data.invoices;
    },

    getInvoiceById: async (id: string): Promise<Invoice | undefined> => {
      const store = await getStore();
      const data = await readAll(store);
      return data.invoices.find((i) => i.id === id);
    },

    createInvoice: async (input: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => {
      const store = await getStore();
      const data = await readAll(store);

      const created: Invoice = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };

      const nextInvoices = [...data.invoices, created];
      const nextSettings: Settings = {
        ...data.settings,
        nextInvoiceNumber: data.settings.nextInvoiceNumber + 1,
      };

      await store.set(KEYS.invoices, nextInvoices);
      await store.set(KEYS.settings, nextSettings);
      await store.save();

      return created;
    },

    updateInvoice: async (id: string, patch: Partial<Invoice>): Promise<Invoice | null> => {
      const store = await getStore();
      const data = await readAll(store);
      const index = data.invoices.findIndex((i) => i.id === id);
      if (index === -1) return null;

      const updated = { ...data.invoices[index], ...patch } as Invoice;
      const next = [...data.invoices];
      next[index] = updated;

      await store.set(KEYS.invoices, next);
      await store.save();
      return updated;
    },

    deleteInvoice: async (id: string): Promise<boolean> => {
      const store = await getStore();
      const data = await readAll(store);
      const next = data.invoices.filter((i) => i.id !== id);
      if (next.length === data.invoices.length) return false;

      await store.set(KEYS.invoices, next);
      await store.save();
      return true;
    },
  };
}
