import type { StorageAdapter } from './storageAdapter';
import type { Client, Invoice, Settings } from '../types';
import { defaultSettings } from './storage';

const DB_URL = 'sqlite:pausaler.db';
const SETTINGS_ID = 'default';
const META_KEY_MIGRATED_FROM_STORE_AT = 'migratedFromStoreAt';
const STORE_FILE = 'pausaler.store.json';

type SqlDb = {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T = unknown>(query: string, bindValues?: unknown[]): Promise<T[]>;
};

type StoreLike = {
  get(key: string): Promise<unknown>;
};

const STORE_KEYS = {
  settings: 'settings',
  clients: 'clients',
  invoices: 'invoices',
} as const;

let dbPromise: Promise<SqlDb> | null = null;

function toIsoNow(): string {
  return new Date().toISOString();
}

function boolToInt(value: boolean | undefined): number | null {
  if (typeof value !== 'boolean') return null;
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean | undefined {
  if (value === null || typeof value === 'undefined') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return undefined;
  return n !== 0;
}

function safeJsonParse<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value);
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

async function getDb(): Promise<SqlDb> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const mod = await import('@tauri-apps/plugin-sql');
    const db = (await mod.default.load(DB_URL)) as unknown as SqlDb;
    await ensureSettingsRow(db);
    await maybeMigrateFromStore(db);
    return db;
  })();

  return dbPromise;
}

async function ensureSettingsRow(db: SqlDb): Promise<void> {
  // Ensure the single settings row exists.
  const rows = await db.select<{ c: number }>(
    'SELECT COUNT(1) as c FROM settings WHERE id = $1',
    [SETTINGS_ID],
  );
  const count = Number((rows[0] as any)?.c ?? 0);
  if (count > 0) return;

  const now = toIsoNow();
  const settings = mergeSettings(defaultSettings);

  await db.execute(
    `INSERT INTO settings (
      id, isConfigured, companyName, pib, address, bankAccount, logoUrl,
      invoicePrefix, nextInvoiceNumber, defaultCurrency, language, data_json, updatedAt
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13
    )`,
    [
      SETTINGS_ID,
      boolToInt(settings.isConfigured),
      settings.companyName,
      settings.pib,
      settings.address,
      settings.bankAccount,
      settings.logoUrl,
      settings.invoicePrefix,
      settings.nextInvoiceNumber,
      settings.defaultCurrency,
      settings.language,
      safeJsonStringify(settings),
      now,
    ],
  );
}

async function getMeta(db: SqlDb, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }>('SELECT value FROM app_meta WHERE key = $1', [key]);
  const value = (rows[0] as any)?.value;
  return typeof value === 'string' ? value : null;
}

async function setMeta(db: SqlDb, key: string, value: string): Promise<void> {
  await db.execute(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

async function loadStoreIfPresent(): Promise<StoreLike | null> {
  // We avoid touching the store unless it actually contains data.
  // Note: Store.load may not create the file until save() is called.
  try {
    const mod = await import('@tauri-apps/plugin-store');
    const store = (await mod.Store.load(STORE_FILE)) as unknown as StoreLike;
    return store;
  } catch {
    return null;
  }
}

async function withTransaction<T>(db: SqlDb, fn: () => Promise<T>): Promise<T> {
  await db.execute('BEGIN IMMEDIATE');
  try {
    const out = await fn();
    await db.execute('COMMIT');
    return out;
  } catch (e) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      // ignore
    }
    throw e;
  }
}

async function maybeMigrateFromStore(db: SqlDb): Promise<void> {
  const already = await getMeta(db, META_KEY_MIGRATED_FROM_STORE_AT);
  if (already) return;

  // If the DB already has any meaningful data, mark migration as done.
  const clientsCount = Number(((await db.select<{ c: number }>('SELECT COUNT(1) as c FROM clients'))[0] as any)?.c ?? 0);
  const invoicesCount = Number(((await db.select<{ c: number }>('SELECT COUNT(1) as c FROM invoices'))[0] as any)?.c ?? 0);
  if (clientsCount > 0 || invoicesCount > 0) {
    await setMeta(db, META_KEY_MIGRATED_FROM_STORE_AT, toIsoNow());
    return;
  }

  const store = await loadStoreIfPresent();
  if (!store) return;

  const settingsRaw = (await store.get(STORE_KEYS.settings)) as unknown;
  const clientsRaw = (await store.get(STORE_KEYS.clients)) as unknown;
  const invoicesRaw = (await store.get(STORE_KEYS.invoices)) as unknown;

  const migratedSettings =
    settingsRaw && typeof settingsRaw === 'object' ? mergeSettings(settingsRaw as Partial<Settings>) : null;
  const migratedClients = Array.isArray(clientsRaw) ? (clientsRaw as Client[]) : [];
  const migratedInvoices = Array.isArray(invoicesRaw) ? (invoicesRaw as Invoice[]) : [];

  const hasAnything =
    (migratedSettings?.isConfigured ?? false) || migratedClients.length > 0 || migratedInvoices.length > 0;
  if (!hasAnything) return;

  await withTransaction(db, async () => {
    if (migratedSettings) {
      const now = toIsoNow();
      const s = migratedSettings;
      await db.execute(
        `UPDATE settings SET
          isConfigured = $2,
          companyName = $3,
          pib = $4,
          address = $5,
          bankAccount = $6,
          logoUrl = $7,
          invoicePrefix = $8,
          nextInvoiceNumber = $9,
          defaultCurrency = $10,
          language = $11,
          data_json = $12,
          updatedAt = $13
         WHERE id = $1`,
        [
          SETTINGS_ID,
          boolToInt(s.isConfigured),
          s.companyName,
          s.pib,
          s.address,
          s.bankAccount,
          s.logoUrl,
          s.invoicePrefix,
          s.nextInvoiceNumber,
          s.defaultCurrency,
          s.language,
          safeJsonStringify(s),
          now,
        ],
      );
    }

    for (const c of migratedClients) {
      await db.execute(
        `INSERT OR REPLACE INTO clients (
          id, name, pib, address, email, phone, createdAt, data_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          c.id,
          c.name,
          c.pib,
          c.address,
          c.email,
          (c as any).phone ?? null,
          c.createdAt,
          safeJsonStringify(c),
        ],
      );
    }

    for (const inv of migratedInvoices) {
      await db.execute(
        `INSERT OR REPLACE INTO invoices (
          id, invoiceNumber, clientId, issueDate, currency, totalAmount, createdAt, data_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          inv.id,
          inv.invoiceNumber,
          inv.clientId,
          inv.issueDate,
          inv.currency,
          inv.total,
          inv.createdAt,
          safeJsonStringify(inv),
        ],
      );
    }

    await setMeta(db, META_KEY_MIGRATED_FROM_STORE_AT, toIsoNow());
  });
}

function formatInvoiceNumber(prefix: string, next: number): string {
  return `${prefix}-${next.toString().padStart(4, '0')}`;
}

async function readInvoiceJson(db: SqlDb, id: string): Promise<Invoice | undefined> {
  const rows = await db.select<{ data_json: string }>('SELECT data_json FROM invoices WHERE id = $1', [id]);
  const json = (rows[0] as any)?.data_json;
  const parsed = safeJsonParse<Invoice>(json);
  return parsed ?? undefined;
}

async function readClientJson(db: SqlDb, id: string): Promise<Client | undefined> {
  const rows = await db.select<{ data_json: string }>('SELECT data_json FROM clients WHERE id = $1', [id]);
  const json = (rows[0] as any)?.data_json;
  const parsed = safeJsonParse<Client>(json);
  return parsed ?? undefined;
}

export function createSqliteStorageAdapter(): StorageAdapter {
  return {
    // Settings
    getSettings: async (): Promise<Settings> => {
      const db = await getDb();
      const rows = await db.select<{ data_json: string; isConfigured: unknown }>(
        'SELECT data_json, isConfigured FROM settings WHERE id = $1',
        [SETTINGS_ID],
      );
      const row = rows[0] as any;
      const parsed = safeJsonParse<Partial<Settings>>(row?.data_json);
      const merged = mergeSettings(parsed);
      const storedIsConfigured = intToBool(row?.isConfigured);
      if (typeof storedIsConfigured === 'boolean') merged.isConfigured = storedIsConfigured;
      return merged;
    },

    updateSettings: async (patch: Partial<Settings>): Promise<Settings> => {
      const db = await getDb();
      const current = await (async () => {
        const rows = await db.select<{ data_json: string; isConfigured: unknown }>(
          'SELECT data_json, isConfigured FROM settings WHERE id = $1',
          [SETTINGS_ID],
        );
        const row = rows[0] as any;
        const parsed = safeJsonParse<Partial<Settings>>(row?.data_json);
        const merged = mergeSettings(parsed);
        const storedIsConfigured = intToBool(row?.isConfigured);
        if (typeof storedIsConfigured === 'boolean') merged.isConfigured = storedIsConfigured;
        return merged;
      })();

      const next = mergeSettings({ ...current, ...patch });
      const now = toIsoNow();

      await db.execute(
        `UPDATE settings SET
          isConfigured = $2,
          companyName = $3,
          pib = $4,
          address = $5,
          bankAccount = $6,
          logoUrl = $7,
          invoicePrefix = $8,
          nextInvoiceNumber = $9,
          defaultCurrency = $10,
          language = $11,
          data_json = $12,
          updatedAt = $13
         WHERE id = $1`,
        [
          SETTINGS_ID,
          boolToInt(next.isConfigured),
          next.companyName,
          next.pib,
          next.address,
          next.bankAccount,
          next.logoUrl,
          next.invoicePrefix,
          next.nextInvoiceNumber,
          next.defaultCurrency,
          next.language,
          safeJsonStringify(next),
          now,
        ],
      );

      return next;
    },

    generateInvoiceNumber: async (): Promise<string> => {
      const db = await getDb();
      const rows = await db.select<{ invoicePrefix: string; nextInvoiceNumber: number }>(
        'SELECT invoicePrefix, nextInvoiceNumber FROM settings WHERE id = $1',
        [SETTINGS_ID],
      );
      const row = rows[0] as any;
      const prefix = String(row?.invoicePrefix ?? defaultSettings.invoicePrefix);
      const next = Number(row?.nextInvoiceNumber ?? defaultSettings.nextInvoiceNumber);
      return formatInvoiceNumber(prefix, next);
    },

    // Clients
    getAllClients: async (): Promise<Client[]> => {
      const db = await getDb();
      const rows = await db.select<{ data_json: string }>('SELECT data_json FROM clients ORDER BY createdAt DESC');
      const out: Client[] = [];
      for (const row of rows as any[]) {
        const parsed = safeJsonParse<Client>(row?.data_json);
        if (parsed) out.push(parsed);
      }
      return out;
    },

    getClientById: async (id: string): Promise<Client | undefined> => {
      const db = await getDb();
      return readClientJson(db, id);
    },

    createClient: async (data: Omit<Client, 'id' | 'createdAt'>): Promise<Client> => {
      const db = await getDb();
      const created: Client = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: toIsoNow(),
      };

      await db.execute(
        `INSERT INTO clients (
          id, name, pib, address, email, phone, createdAt, data_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          created.id,
          created.name,
          created.pib,
          created.address,
          created.email,
          (created as any).phone ?? null,
          created.createdAt,
          safeJsonStringify(created),
        ],
      );

      return created;
    },

    updateClient: async (id: string, patch: Partial<Client>): Promise<Client | null> => {
      const db = await getDb();
      const existing = await readClientJson(db, id);
      if (!existing) return null;

      const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt } as Client;

      await db.execute(
        `UPDATE clients SET
          name = $2,
          pib = $3,
          address = $4,
          email = $5,
          phone = $6,
          data_json = $7
         WHERE id = $1`,
        [
          id,
          updated.name,
          updated.pib,
          updated.address,
          updated.email,
          (updated as any).phone ?? null,
          safeJsonStringify(updated),
        ],
      );

      return updated;
    },

    deleteClient: async (id: string): Promise<boolean> => {
      const db = await getDb();
      await db.execute('DELETE FROM clients WHERE id = $1', [id]);
      return true;
    },

    // Invoices
    getAllInvoices: async (): Promise<Invoice[]> => {
      const db = await getDb();
      const rows = await db.select<{ data_json: string }>('SELECT data_json FROM invoices ORDER BY createdAt DESC');
      const out: Invoice[] = [];
      for (const row of rows as any[]) {
        const parsed = safeJsonParse<Invoice>(row?.data_json);
        if (parsed) out.push(parsed);
      }
      return out;
    },

    getInvoiceById: async (id: string): Promise<Invoice | undefined> => {
      const db = await getDb();
      return readInvoiceJson(db, id);
    },

    createInvoice: async (input: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => {
      const db = await getDb();

      return withTransaction(db, async () => {
        const settingsRows = await db.select<{ invoicePrefix: string; nextInvoiceNumber: number }>(
          'SELECT invoicePrefix, nextInvoiceNumber FROM settings WHERE id = $1',
          [SETTINGS_ID],
        );
        const srow = settingsRows[0] as any;
        const prefix = String(srow?.invoicePrefix ?? defaultSettings.invoicePrefix);
        const nextNum = Number(srow?.nextInvoiceNumber ?? defaultSettings.nextInvoiceNumber);

        const invoiceNumber = String(input.invoiceNumber ?? '').trim() || formatInvoiceNumber(prefix, nextNum);

        const created: Invoice = {
          ...input,
          invoiceNumber,
          id: crypto.randomUUID(),
          createdAt: toIsoNow(),
        };

        await db.execute(
          `INSERT INTO invoices (
            id, invoiceNumber, clientId, issueDate, currency, totalAmount, createdAt, data_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8
          )`,
          [
            created.id,
            created.invoiceNumber,
            created.clientId,
            created.issueDate,
            created.currency,
            created.total,
            created.createdAt,
            safeJsonStringify(created),
          ],
        );

        // Atomic increment (matches previous store behavior).
        await db.execute(
          'UPDATE settings SET nextInvoiceNumber = nextInvoiceNumber + 1, updatedAt = $2 WHERE id = $1',
          [SETTINGS_ID, toIsoNow()],
        );

        return created;
      });
    },

    updateInvoice: async (id: string, patch: Partial<Invoice>): Promise<Invoice | null> => {
      const db = await getDb();
      const existing = await readInvoiceJson(db, id);
      if (!existing) return null;

      const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt } as Invoice;

      await db.execute(
        `UPDATE invoices SET
          invoiceNumber = $2,
          clientId = $3,
          issueDate = $4,
          currency = $5,
          totalAmount = $6,
          data_json = $7
         WHERE id = $1`,
        [
          id,
          updated.invoiceNumber,
          updated.clientId,
          updated.issueDate,
          updated.currency,
          updated.total,
          safeJsonStringify(updated),
        ],
      );

      return updated;
    },

    deleteInvoice: async (id: string): Promise<boolean> => {
      const db = await getDb();
      await db.execute('DELETE FROM invoices WHERE id = $1', [id]);
      return true;
    },
  };
}
