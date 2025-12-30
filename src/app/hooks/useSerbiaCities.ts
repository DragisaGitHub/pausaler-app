import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSerbiaCities, SerbiaCityDto } from '../services/serbiaZipCodes';

export type SerbiaCitySelectOption = {
  label: string;
  value: string; // city name
  postalCode: string;
};

let cachedRows: SerbiaCityDto[] | null = null;
let cachedLoad: Promise<SerbiaCityDto[]> | null = null;

function normalizeSerbianLatin(input: string): string {
  return input
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'dj');
}

async function loadOnce(): Promise<SerbiaCityDto[]> {
  if (cachedRows) return cachedRows;
  if (!cachedLoad) {
    cachedLoad = listSerbiaCities().then((rows) => {
      cachedRows = rows;
      return rows;
    });
  }
  return cachedLoad;
}

export function useSerbiaCities() {
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState<SerbiaCityDto[]>([]);
  const [query, setQuery] = useState('');
  const didInit = useRef(false);

  const ensureLoaded = useCallback(async () => {
    if (didInit.current) return;
    didInit.current = true;

    setLoading(true);
    try {
      const rows = await loadOnce();
      setAll(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const options: SerbiaCitySelectOption[] = useMemo(() => {
    const q = normalizeSerbianLatin(query.trim());
    const filtered = q
      ? all.filter((r) => normalizeSerbianLatin(r.city).includes(q))
      : all;

    return filtered.map((r) => ({
      label: r.city,
      value: r.city,
      postalCode: r.postalCode,
    }));
  }, [all, query]);

  const byCity = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of all) {
      if (!map.has(r.city)) map.set(r.city, r.postalCode);
    }
    return map;
  }, [all]);

  const search = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
  }, []);

  const resolvePostalCode = useCallback(
    (city: string) => {
      return byCity.get(city);
    },
    [byCity]
  );

  return { options, loading, search, resolvePostalCode };
}
