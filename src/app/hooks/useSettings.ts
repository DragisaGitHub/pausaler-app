import { useCallback, useEffect, useState } from 'react';
import { Settings } from '../types';
import { settingsService } from '../services/storage';

type UseSettingsResult = {
    settings: Settings | null;
    loading: boolean;
    save: (next: Settings) => Promise<void>;
};

export function useSettings(): UseSettingsResult {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setSettings(settingsService.get());
    }, []);

    const save = useCallback(async (next: Settings) => {
        setLoading(true);
        try {
            const updated = settingsService.update(next);
            setSettings(updated);
        } finally {
            setLoading(false);
        }
    }, []);

    return { settings, loading, save };
}