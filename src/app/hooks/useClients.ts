import { useCallback, useEffect, useState } from 'react';
import { getStorage } from '../services/storageProvider';
import { Client } from '../types';

const storage = getStorage();

export const useClients = () => {
    const [clients, setClients] = useState<Client[]>([]);

    const refresh = useCallback(async () => {
        const next = await storage.getAllClients();
        setClients(next);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const createClient = useCallback(
        async (data: Omit<Client, 'id' | 'createdAt'>) => {
            const created = await storage.createClient(data);
            await refresh();
            return created;
        },
        [refresh]
    );

    const updateClient = useCallback(
        async (id: string, patch: Partial<Client>) => {
            const updated = await storage.updateClient(id, patch);
            await refresh();
            return updated;
        },
        [refresh]
    );

    const deleteClient = useCallback(
        async (id: string) => {
            const ok = await storage.deleteClient(id);
            await refresh();
            return ok;
        },
        [refresh]
    );

    return { clients, refresh, createClient, updateClient, deleteClient };
};