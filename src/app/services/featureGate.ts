import type { LicenseStatus, LockLevel } from '../types/license';

export type Feature =
  | 'APP_ACCESS'
  | 'VIEW_DATA'
  | 'CLIENTS_WRITE'
  | 'EXPENSES_WRITE'
  | 'INVOICES_WRITE'
  | 'INVOICES_EXPORT_PDF'
  | 'INVOICES_SEND_EMAIL'
  | 'EXPORTS_CSV'
  | 'SETTINGS_WRITE';

type FeatureMatrix = Record<LockLevel, Record<Feature, boolean>>;

const MATRIX: FeatureMatrix = {
  NONE: {
    APP_ACCESS: true,
    VIEW_DATA: true,
    CLIENTS_WRITE: true,
    EXPENSES_WRITE: true,
    INVOICES_WRITE: true,
    INVOICES_EXPORT_PDF: true,
    INVOICES_SEND_EMAIL: true,
    EXPORTS_CSV: true,
    SETTINGS_WRITE: true,
  },
  VIEW_ONLY: {
    APP_ACCESS: true,
    VIEW_DATA: true,
    CLIENTS_WRITE: false,
    EXPENSES_WRITE: false,
    INVOICES_WRITE: false,
    INVOICES_EXPORT_PDF: false,
    INVOICES_SEND_EMAIL: false,
    EXPORTS_CSV: false,
    SETTINGS_WRITE: false,
  },
  HARD: {
    APP_ACCESS: false,
    VIEW_DATA: false,
    CLIENTS_WRITE: false,
    EXPENSES_WRITE: false,
    INVOICES_WRITE: false,
    INVOICES_EXPORT_PDF: false,
    INVOICES_SEND_EMAIL: false,
    EXPORTS_CSV: false,
    SETTINGS_WRITE: false,
  },
};

export function isFeatureAllowed(status: LicenseStatus, feature: Feature): boolean {
  const level = status.lockLevel ?? 'NONE';
  return MATRIX[level]?.[feature] ?? false;
}
