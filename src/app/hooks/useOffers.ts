import { useCallback, useEffect, useState } from 'react';

import type { Offer } from '../types';
import { getStorage } from '../services/storageProvider';

const storage = getStorage();

export function useOffers() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);

  const loadOffers = useCallback(async () => {
    setLoading(true);
    try {
      const next = await storage.getAllOffers();
      setOffers(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  const createOffer = useCallback(
    async (data: Omit<Offer, 'id' | 'createdAt'>) => {
      const created = await storage.createOffer(data);
      await loadOffers();
      return created;
    },
    [loadOffers]
  );

  const updateOffer = useCallback(
    async (id: string, patch: Partial<Omit<Offer, 'id' | 'createdAt'>>) => {
      const updated = await storage.updateOffer(id, patch);
      await loadOffers();
      return updated;
    },
    [loadOffers]
  );

  const deleteOffer = useCallback(
    async (id: string) => {
      const ok = await storage.deleteOffer(id);
      await loadOffers();
      return ok;
    },
    [loadOffers]
  );

  const sendOfferEmail = useCallback(
    async (offerId: string) => {
      const ok = await storage.sendOfferEmail({ offerId });
      await loadOffers();
      return ok;
    },
    [loadOffers]
  );

  return {
    loading,
    offers,
    loadOffers,
    createOffer,
    updateOffer,
    deleteOffer,
    sendOfferEmail,
  };
}