import { createSqliteStorageAdapter } from './sqliteStorageAdapter';
import type { StorageAdapter } from './storageAdapter';

let singleton: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (singleton) return singleton;

  // Production-style: always use SQLite persistence.
  singleton = createSqliteStorageAdapter();
  return singleton;
}
