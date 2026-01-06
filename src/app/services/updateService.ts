import { invoke } from '@tauri-apps/api/core';

export type UpdateManifest = {
  version: string;
  releasedAt: string;
  notes: string[];
  windows: {
    nsis: string;
    msi?: string;
  };
};

export type UpdateCheckResult = {
  latest: UpdateManifest;
  updateAvailable: boolean;
  nsisUrl?: string;
};

const UPDATE_MANIFEST_URL = 'https://pausaler.rs/updates/latest.json';

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(id),
  };
}

function normalizeSemver(v: string): string {
  return String(v ?? '').trim().replace(/^v/i, '');
}

export function compareSemver(a: string, b: string): number {
  const aa = normalizeSemver(a);
  const bb = normalizeSemver(b);

  if (!/^\d+\.\d+\.\d+$/.test(aa) || !/^\d+\.\d+\.\d+$/.test(bb)) {
    throw new Error('Invalid version format');
  }

  const ap = aa.split('.').map((s) => Number(s));
  const bp = bb.split('.').map((s) => Number(s));

  for (let i = 0; i < 3; i++) {
    const av = ap[i];
    const bv = bp[i];
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function validateManifest(raw: unknown): UpdateManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid update manifest');

  const version = String((raw as any).version ?? '').trim();
  if (!version) throw new Error('Invalid update manifest: missing version');
  if (!/^\d+\.\d+\.\d+$/.test(normalizeSemver(version))) {
    throw new Error('Invalid update manifest: version must be x.y.z');
  }

  const releasedAt = String((raw as any).releasedAt ?? '').trim();
  if (!releasedAt) throw new Error('Invalid update manifest: missing releasedAt');

  const notesRaw = (raw as any).notes;
  if (!Array.isArray(notesRaw)) throw new Error('Invalid update manifest: notes must be an array');
  const notes = notesRaw.map((n: any) => String(n ?? '').trim()).filter((n: string) => !!n);

  const windows = (raw as any).windows;
  const nsis = windows && typeof windows === 'object' ? (windows as any).nsis : undefined;
  const msi = windows && typeof windows === 'object' ? (windows as any).msi : undefined;

  const nsisUrl = nsis == null ? '' : String(nsis).trim();
  if (!nsisUrl) throw new Error('Installer URL is missing in the update manifest.');

  return {
    version,
    releasedAt,
    notes,
    windows: {
      nsis: nsisUrl,
      msi: msi == null ? undefined : String(msi).trim() || undefined,
    },
  };
}

export async function fetchLatestUpdateManifest(args?: { timeoutMs?: number }): Promise<UpdateManifest> {
  const timeoutMs = Math.max(1000, Number(args?.timeoutMs ?? 8000));
  const { signal, cancel } = withTimeoutSignal(timeoutMs);

  try {
    const res = await fetch(UPDATE_MANIFEST_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!res.ok) {
      throw new Error(`Update server error (HTTP ${res.status})`);
    }

    const json = await res.json();
    return validateManifest(json);
  } catch (e: any) {
    const aborted = e && typeof e === 'object' && (e.name === 'AbortError' || e.code === 20);
    if (aborted) throw new Error('Update check timed out. Please try again.');
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    throw new Error(msg || 'Failed to check for updates');
  } finally {
    cancel();
  }
}

export async function checkForUpdates(currentVersion: string, args?: { timeoutMs?: number }): Promise<UpdateCheckResult> {
  const latest = await fetchLatestUpdateManifest({ timeoutMs: args?.timeoutMs });
  const updateAvailable = compareSemver(latest.version, currentVersion) > 0;
  const nsisUrl = latest.windows?.nsis ? String(latest.windows.nsis).trim() : undefined;
  return { latest, updateAvailable, nsisUrl };
}

type UpdateCacheSnapshot = {
  result: UpdateCheckResult | null;
  error: string | null;
  checkedAt: number | null;
};

let cachedPromise: Promise<UpdateCheckResult> | null = null;
let cachedSnapshot: UpdateCacheSnapshot = { result: null, error: null, checkedAt: null };
const cacheEvents = new EventTarget();

function notifyCacheChanged() {
  cacheEvents.dispatchEvent(new Event('change'));
}

export function getUpdateCheckCache(): UpdateCacheSnapshot {
  return cachedSnapshot;
}

export function subscribeUpdateCheckCache(onChange: () => void): () => void {
  const handler = () => onChange();
  cacheEvents.addEventListener('change', handler);
  return () => {
    cacheEvents.removeEventListener('change', handler);
  };
}

export async function checkForUpdatesCached(
  currentVersion: string,
  args?: { timeoutMs?: number; force?: boolean; maxAgeMs?: number }
): Promise<UpdateCheckResult> {
  const force = args?.force === true;
  const maxAgeMsRaw = args?.maxAgeMs;
  const maxAgeMs = maxAgeMsRaw == null ? null : Math.max(1000, Number(maxAgeMsRaw));
  if (!force) {
    if (cachedSnapshot.result) {
      if (maxAgeMs == null) return cachedSnapshot.result;
      const checkedAt = cachedSnapshot.checkedAt;
      if (checkedAt != null && Date.now() - checkedAt <= maxAgeMs) return cachedSnapshot.result;
    }
    if (cachedPromise) return cachedPromise;
  }

  cachedPromise = checkForUpdates(currentVersion, { timeoutMs: args?.timeoutMs })
    .then((res) => {
      cachedSnapshot = { result: res, error: null, checkedAt: Date.now() };
      notifyCacheChanged();
      return res;
    })
    .catch((e: any) => {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      cachedSnapshot = { result: null, error: msg || 'Failed to check for updates', checkedAt: Date.now() };
      notifyCacheChanged();
      throw e;
    })
    .finally(() => {
      cachedPromise = null;
    });

  return cachedPromise;
}

export async function downloadNsisInstaller(url: string): Promise<string> {
  const u = String(url ?? '').trim();
  if (!u) throw new Error('Missing installer URL');
  return invoke<string>('download_update_installer', { url: u });
}

export async function runInstallerAndExit(installerPath: string): Promise<boolean> {
  const p = String(installerPath ?? '').trim();
  if (!p) throw new Error('Missing installer path');
  return invoke<boolean>('run_installer_and_exit', { installer_path: p });
}
