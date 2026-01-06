import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdatesCached, getUpdateCheckCache, subscribeUpdateCheckCache } from '../services/updateService.ts';

type UpdateBadgeState = {
  available: boolean;
  latestVersion?: string;
};

export function useUpdateBadge(args?: { maxAgeMs?: number; timeoutMs?: number }): UpdateBadgeState {
  const [state, setState] = useState<UpdateBadgeState>(() => {
    const snap = getUpdateCheckCache();
    const latestVersion = snap.result?.latest?.version;
    const available = snap.result?.updateAvailable === true;
    return { available, latestVersion };
  });

  useEffect(() => {
    let mounted = true;
    const timeoutMs = Math.max(1000, Number(args?.timeoutMs ?? 3000));
    const maxAgeMs = Math.max(1000, Number(args?.maxAgeMs ?? 6 * 60 * 60 * 1000));

    const unsub = subscribeUpdateCheckCache(() => {
      const snap = getUpdateCheckCache();
      const latestVersion = snap.result?.latest?.version;
      const available = snap.result?.updateAvailable === true;
      if (!mounted) return;
      setState({ available, latestVersion });
    });

    void (async () => {
      try {
        const current = await getVersion();
        await checkForUpdatesCached(String(current ?? ''), { timeoutMs, force: false, maxAgeMs });
      } catch {
        if (!mounted) return;
        setState({ available: false });
      }
    })();

    return () => {
      mounted = false;
      unsub();
    };
  }, [args?.timeoutMs, args?.maxAgeMs]);

  return state;
}
