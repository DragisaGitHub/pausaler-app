import { getStorage } from './storageProvider';
import type { LicenseStatus, LockLevel, LockReason } from '../types/license';
import { ensureTrialHydrated, getTrialInfo, isTrialActive, startTrialIfNeeded } from './trialService';
import { generateActivationCode as rustGenerateActivationCode, getAppMeta, setAppMeta, verifyLicense as rustVerifyLicense } from './licenseCodeGenerator';
import { getDevForcedLockInfo } from './devLockService';

const storage = getStorage();

const LICENSE_RAW_KEY = 'licenseRaw';

let cachedLicenseRaw: string | null = null;
let licenseHydrated = false;

async function hydrateLicense(): Promise<void> {
  if (licenseHydrated) return;
  licenseHydrated = true;
  const raw = await getAppMeta(LICENSE_RAW_KEY);
  cachedLicenseRaw = raw ? String(raw) : null;
}

export async function generateActivationCode(): Promise<string> {
  const settings = await storage.getSettings();
  const pib = String(settings.pib ?? '').trim();
  if (!pib) throw new Error('PIB is missing');
  return rustGenerateActivationCode(pib);
}

export async function validateAndStoreLicense(licenseString: string): Promise<boolean> {
  const settings = await storage.getSettings();
  const pib = String(settings.pib ?? '').trim();
  if (!pib) return false;

  const raw = String(licenseString ?? '').trim();
  if (!raw) return false;

  const verified = await rustVerifyLicense(raw, pib);
  if (!verified.is_valid) return false;

  await setAppMeta(LICENSE_RAW_KEY, raw);
  cachedLicenseRaw = raw;
  return true;
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const devForced = await getDevForcedLockInfo();
  if (devForced.effectiveLevel && devForced.effectiveReason) {
    const lockLevel: LockLevel = devForced.effectiveLevel;
    const lockReason: LockReason = devForced.effectiveReason;
    return {
      isLicensed: false,
      isTrialActive: false,
      lockLevel,
      lockReason,
      isLocked: lockLevel !== 'NONE',
      reason: lockReason,
    };
  }

  const settings = await storage.getSettings();

  const configured = settings.isConfigured === true;
  if (!configured) {
    return {
      isLicensed: false,
      isTrialActive: false,
      lockLevel: 'NONE',
      isLocked: false,
    };
  }

  const pib = String(settings.pib ?? '').trim();
  if (pib) startTrialIfNeeded(pib);
  if (!pib) {
    return {
      isLicensed: false,
      isTrialActive: false,
      lockLevel: 'VIEW_ONLY',
      lockReason: 'missing_pib',
      isLocked: true,
      reason: 'missing_pib',
    };
  }

  await ensureTrialHydrated();
  await hydrateLicense();

  const trialActive = isTrialActive();

  if (cachedLicenseRaw) {
    const verified = await rustVerifyLicense(cachedLicenseRaw, pib);
    if (verified.is_valid) {
      return {
        isLicensed: true,
        isTrialActive: trialActive,
        lockLevel: 'NONE',
        isLocked: false,
        validUntil: verified.valid_until ?? undefined,
      };
    }

    if (trialActive) {
      return {
        isLicensed: false,
        isTrialActive: true,
        lockLevel: 'NONE',
        isLocked: false,
        reason: verified.reason ?? 'license_invalid',
      };
    }

    return {
      isLicensed: false,
      isTrialActive: false,
      lockLevel: 'VIEW_ONLY',
      lockReason: 'license_invalid',
      isLocked: true,
      reason: verified.reason ?? 'license_invalid',
    };
  }

  if (trialActive) {
    return { isLicensed: false, isTrialActive: true, lockLevel: 'NONE', isLocked: false };
  }

  const trial = getTrialInfo();
  if (trial?.trialEndsAt) {
    return {
      isLicensed: false,
      isTrialActive: false,
      lockLevel: 'VIEW_ONLY',
      lockReason: 'trial_expired',
      isLocked: true,
      reason: 'trial_expired',
    };
  }

  return {
    isLicensed: false,
    isTrialActive: false,
    lockLevel: 'VIEW_ONLY',
    lockReason: 'license_required',
    isLocked: true,
    reason: 'license_required',
  };
}

export async function isLicenseActive(): Promise<boolean> {
  const s = await getLicenseStatus();
  return s.isLicensed === true;
}

export function getStoredLicense(): string | null {
  return cachedLicenseRaw;
}
