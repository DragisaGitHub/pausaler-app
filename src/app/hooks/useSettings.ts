import { useCallback, useEffect, useState } from 'react';
import { Settings } from '../types';
import { getStorage } from '../services/storageProvider';

type UseSettingsResult = {
    settings: Settings | null;
    loading: boolean;
    save: (next: Settings) => Promise<void>;
};

export function useSettings(): UseSettingsResult {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const storage = getStorage();

        setLoading(true);
        void (async () => {
            try {
                const loaded = await storage.getSettings();
                if (!cancelled) setSettings(loaded);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const save = useCallback(async (next: Settings) => {
        const storage = getStorage();
        setLoading(true);
        try {
            // Prepare a partial patch that does not overwrite smtpPassword when blank
            const patch: Partial<Settings> = { ...next };
            const pwd = String(next.smtpPassword ?? '').trim();
            if (!pwd) {
                delete (patch as any).smtpPassword;
            } else {
                patch.smtpPassword = pwd;
            }

            const updated = await storage.updateSettings(patch);
            setSettings(updated);
        } finally {
            setLoading(false);
        }
    }, []);

    return { settings, loading, save };
}