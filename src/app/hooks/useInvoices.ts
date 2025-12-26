import { useCallback, useEffect, useState } from 'react';
import {Invoice} from "../types";
import {invoiceService} from "../services/storage.ts";

export const useInvoices = () => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);

    const refresh = useCallback(() => {
        setInvoices(invoiceService.getAll());
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const createInvoice = useCallback(
        (data: Omit<Invoice, 'id' | 'createdAt'>) => {
            const created = invoiceService.create(data);
            refresh();
            return created;
        },
        [refresh]
    );

    const updateInvoice = useCallback(
        (id: string, patch: Partial<Invoice>) => {
            const updated = invoiceService.update(id, patch);
            refresh();
            return updated;
        },
        [refresh]
    );

    const deleteInvoice = useCallback(
        (id: string) => {
            const ok = invoiceService.delete(id);
            refresh();
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