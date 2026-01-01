import type { TrialInfo } from '../types/license';
import { getAppMeta, setAppMeta } from './licenseCodeGenerator';

const TRIAL_START_KEY = 'trialStartDate';
const TRIAL_END_KEY = 'trialEndsAt';

let cachedTrial: TrialInfo | null = null;
let trialHydrated = false;

function computeStatus(startIso: string, endIso: string): TrialInfo {
  const now = Date.now();
  const end = Date.parse(endIso);
  const status: TrialInfo['status'] = Number.isFinite(end) && now < end ? 'ACTIVE' : 'EXPIRED';
  return { trialStartDate: startIso, trialEndsAt: endIso, status };
}

async function hydrateTrial(): Promise<void> {
  if (trialHydrated) return;
  trialHydrated = true;

  const start = await getAppMeta(TRIAL_START_KEY);
  const end = await getAppMeta(TRIAL_END_KEY);
  if (start && end) {
    cachedTrial = computeStatus(start, end);
  }
}

export function startTrialIfNeeded(companyPib: string): void {
  void (async () => {
    await hydrateTrial();
    if (cachedTrial) return;

    const pib = String(companyPib ?? '').trim();
    if (!pib) return;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    await setAppMeta(TRIAL_START_KEY, startIso);
    await setAppMeta(TRIAL_END_KEY, endIso);

    cachedTrial = computeStatus(startIso, endIso);
  })();
}

export function getTrialInfo(): TrialInfo | null {
  return cachedTrial;
}

export function isTrialActive(): boolean {
  if (!cachedTrial) return false;
  return cachedTrial.status === 'ACTIVE';
}

export async function ensureTrialHydrated(): Promise<void> {
  await hydrateTrial();
}
