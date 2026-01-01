import { invoke } from '@tauri-apps/api/core';

export type RustVerifiedLicenseInfo = {
  license_type?: string | null;
  valid_until?: string | null;
  is_valid: boolean;
  reason?: string | null;
};

export async function hashPib(pib: string): Promise<string> {
  return invoke<string>('hash_pib', { pib });
}

export async function generateActivationCode(pib: string): Promise<string> {
  return invoke<string>('generate_activation_code', { pib });
}

export async function verifyLicense(license: string, pib: string): Promise<RustVerifiedLicenseInfo> {
  return invoke<RustVerifiedLicenseInfo>('verify_license', { license, pib });
}

export async function getForceLockedEnv(): Promise<boolean> {
  return invoke<boolean>('get_force_locked_env');
}

export async function getForceLockLevelEnv(): Promise<'VIEW_ONLY' | 'HARD' | null> {
  const res = await invoke<string | null>('get_force_lock_level_env');
  if (!res) return null;
  const v = String(res).trim().toUpperCase();
  if (v === 'VIEW_ONLY') return 'VIEW_ONLY';
  if (v === 'HARD') return 'HARD';
  return null;
}

export async function getAppMeta(key: string): Promise<string | null> {
  const res = await invoke<string | null>('get_app_meta', { key });
  return res ?? null;
}

export async function setAppMeta(key: string, value: string): Promise<boolean> {
  return invoke<boolean>('set_app_meta', { key, value });
}
