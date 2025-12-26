import { useCallback, useEffect, useState } from 'react';
import {clientService} from "../services/storage.ts";
import {Client} from "../types";

export const useClients = () => {
    const [clients, setClients] = useState<Client[]>([]);

    const refresh = useCallback(() => {
        setClients(clientService.getAll());
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const createClient = useCallback((data: Omit<Client, 'id' | 'createdAt'>) => {
        const created = clientService.create(data);
        refresh();
        return created;
    }, [refresh]);

    const updateClient = useCallback((id: string, patch: Partial<Client>) => {
        const updated = clientService.update(id, patch);
        refresh();
        return updated;
    }, [refresh]);

    const deleteClient = useCallback((id: string) => {
        const ok = clientService.delete(id);
        refresh();
        return ok;
    }, [refresh]);

    return { clients, refresh, createClient, updateClient, deleteClient };
};