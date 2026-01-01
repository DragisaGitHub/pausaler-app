import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LicenseStatus } from '../types/license';
import { getLicenseStatus } from '../services/licenseService';
import { TrialExpiredModal } from './TrialExpiredModal';
import { isFeatureAllowed } from '../services/featureGate';

type LicenseGateContextValue = {
  status: LicenseStatus;
  refresh: () => Promise<void>;
};

const LicenseGateContext = createContext<LicenseGateContextValue | null>(null);

export function useLicenseGate(): LicenseGateContextValue {
  const ctx = useContext(LicenseGateContext);
  if (!ctx) {
    throw new Error('LicenseGateContext missing');
  }
  return ctx;
}

export function LicenseGate({ needsSetup, children }: { needsSetup: boolean; children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [status, setStatus] = useState<LicenseStatus>({
    isLicensed: false,
    isTrialActive: false,
    lockLevel: 'NONE',
    isLocked: false,
  });

  const refresh = useCallback(async () => {
    if (needsSetup) {
      setStatus({ isLicensed: false, isTrialActive: false, lockLevel: 'NONE', isLocked: false });
      return;
    }

    const s = await getLicenseStatus();
    setStatus(s);
  }, [needsSetup]);

  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  const ctx = useMemo(() => ({ status, refresh }), [status, refresh]);

  const hardLocked = !needsSetup && !isFeatureAllowed(status, 'APP_ACCESS');
  const onOpenLicense = () => {
    navigate('/license');
  };

  return (
    <LicenseGateContext.Provider value={ctx}>
      {children}
      <TrialExpiredModal open={hardLocked && location.pathname !== '/license' && location.pathname !== '/setup'} onOpenLicense={onOpenLicense} />
    </LicenseGateContext.Provider>
  );
}
