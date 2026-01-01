import { getAppMeta, getForceLockLevelEnv, getForceLockedEnv, setAppMeta } from './licenseCodeGenerator';
import type { LockLevel } from '../types/license';

const DEV_FORCED_LOCK_LEVEL_KEY = 'dev_forced_lock_level';
const DEV_FORCED_LOCK_KEY_LEGACY = 'dev_forced_locked';

function isTruthy(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function normalizePersistedLevel(v: string | null | undefined): LockLevel | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'view_only' || s === 'view-only' || s === 'viewonly' || s === 'view') return 'VIEW_ONLY';
  if (s === 'hard' || s === 'locked' || s === 'lock') return 'HARD';
  if (s === 'none' || s === 'off' || s === '0' || s === 'false') return null;
  return null;
}

export type DevForcedLockInfo = {
  envLevel: LockLevel | null;
  persistedLevel: LockLevel | null;
  effectiveLevel: LockLevel | null;
  effectiveReason:
    | 'forced_view_only_env'
    | 'forced_hard_env'
    | 'forced_view_only_persisted'
    | 'forced_hard_persisted'
    | null;
};

export async function getDevForcedLockInfo(): Promise<DevForcedLockInfo> {
  if (!import.meta.env.DEV) {
    return { envLevel: null, persistedLevel: null, effectiveLevel: null, effectiveReason: null };
  }

  const [envLevel, persistedRaw, persistedLegacyRaw, legacyEnvForced] = await Promise.all([
    getForceLockLevelEnv(),
    getAppMeta(DEV_FORCED_LOCK_LEVEL_KEY),
    getAppMeta(DEV_FORCED_LOCK_KEY_LEGACY),
    getForceLockedEnv(),
  ]);

  const persistedLevel = normalizePersistedLevel(persistedRaw) ?? (isTruthy(persistedLegacyRaw) ? 'HARD' : null);
  const envEffectiveLevel: LockLevel | null = envLevel ?? (legacyEnvForced ? 'HARD' : null);

  const effectiveLevel: LockLevel | null = envEffectiveLevel ?? persistedLevel;

  const effectiveReason: DevForcedLockInfo['effectiveReason'] = envEffectiveLevel
    ? envEffectiveLevel === 'VIEW_ONLY'
      ? 'forced_view_only_env'
      : 'forced_hard_env'
    : persistedLevel
      ? persistedLevel === 'VIEW_ONLY'
        ? 'forced_view_only_persisted'
        : 'forced_hard_persisted'
      : null;

  return { envLevel: envEffectiveLevel, persistedLevel, effectiveLevel, effectiveReason };
}

export async function setDevForcedLockLevelPersisted(level: LockLevel | null): Promise<void> {
  if (!import.meta.env.DEV) return;
  await setAppMeta(DEV_FORCED_LOCK_LEVEL_KEY, level ? String(level) : '');
  // Keep legacy key in sync for older builds (best-effort).
  await setAppMeta(DEV_FORCED_LOCK_KEY_LEGACY, level ? 'true' : 'false');
}
