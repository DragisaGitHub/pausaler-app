import { useCallback, useEffect, useState } from 'react';
import { Invoice } from '../types';
import { getStorage } from '../services/storageProvider';

const storage = getStorage();

export const useInvoices = () => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);

    const refresh = useCallback(async () => {
        const next = await storage.getAllInvoices();
        setInvoices(next);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const createInvoice = useCallback(
        async (data: Omit<Invoice, 'id' | 'createdAt'>) => {
            const created = await storage.createInvoice(data);
            await refresh();
            return created;
        },
        [refresh]
    );

    const updateInvoice = useCallback(
        async (id: string, patch: Partial<Invoice>) => {
            const updated = await storage.updateInvoice(id, patch);
            await refresh();
            return updated;
        },
        [refresh]
    );

    const deleteInvoice = useCallback(
        async (id: string) => {
            const ok = await storage.deleteInvoice(id);
            await refresh();
            return ok;
        },
        [refresh]
    );

    return {
        invoices,
        createInvoice,
        updateInvoice,
        deleteInvoice,
    };
};