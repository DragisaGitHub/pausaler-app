import { useCallback, useEffect, useRef, useState } from 'react';
import type { Expense, ExpenseRange } from '../types';
import { getStorage } from '../services/storageProvider';

const storage = getStorage();

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const lastRangeRef = useRef<ExpenseRange | undefined>(undefined);

  const listExpenses = useCallback(async (range?: ExpenseRange) => {
    lastRangeRef.current = range;
    const next = await storage.listExpenses(range);
    setExpenses(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const next = await storage.listExpenses(lastRangeRef.current);
    setExpenses(next);
    return next;
  }, []);

  useEffect(() => {
    void listExpenses();
  }, [listExpenses]);

  const createExpense = useCallback(
    async (data: Omit<Expense, 'id' | 'createdAt'>) => {
      const created = await storage.createExpense(data);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateExpense = useCallback(
    async (id: string, patch: Partial<Omit<Expense, 'id' | 'createdAt'>>) => {
      const updated = await storage.updateExpense(id, patch);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      const ok = await storage.deleteExpense(id);
      await refresh();
      return ok;
    },
    [refresh]
  );

  return {
    expenses,
    listExpenses,
    refresh,
    createExpense,
    updateExpense,
    deleteExpense,
  };
}
