export type LicenseType = 'TRIAL' | 'YEARLY' | 'LIFETIME';

export type LockLevel = 'NONE' | 'VIEW_ONLY' | 'HARD';

export type LockReason =
  | 'none'
  | 'trial_expired'
  | 'license_required'
  | 'license_invalid'
  | 'missing_pib'
  | 'forced_view_only_env'
  | 'forced_hard_env'
  | 'forced_view_only_persisted'
  | 'forced_hard_persisted';

export type TrialInfo = {
  trialStartDate: string;
  trialEndsAt: string;
  status: 'ACTIVE' | 'EXPIRED';
};

export type LicensePayload = {
  licenseType: 'YEARLY' | 'LIFETIME';
  validFrom: string;
  validUntil?: string;
  pibHash: string;
  signature: string;
};

export type LicenseStatus = {
  isLicensed: boolean;
  isTrialActive: boolean;
  lockLevel: LockLevel;
  lockReason?: LockReason;
  isLocked: boolean;
  reason?: string;
  validUntil?: string;
};
