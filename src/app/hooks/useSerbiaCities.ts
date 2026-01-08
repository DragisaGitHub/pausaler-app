import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSerbiaCities, SerbiaCityDto } from '../services/serbiaZipCodes';

export type SerbiaCitySelectOption = {
  label: string;
  value: string; // unique postal code
  city: string;
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
  const [searchValue, setSearchValue] = useState('');
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
    const counts = new Map<string, number>();
    for (const r of all) {
      counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
    }
    const base = all.map((r) => {
      const dup = (counts.get(r.city) ?? 0) > 1;
      const label = dup ? `${r.city} (${r.postalCode})` : r.city;
      return {
        label,
        value: r.postalCode, // unique key
        city: r.city,
        postalCode: r.postalCode,
      };
    });
    if (!q) return base;
    return base.filter((opt) => normalizeSerbianLatin(opt.label).includes(q));
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
    setSearchValue(nextQuery);
  }, []);

  const initSearchFromText = useCallback((text: string) => {
    const v = String(text ?? '').trim();
    setQuery(v);
    setSearchValue(v);
  }, []);

  const resolvePostalCode = useCallback(
    (city: string) => {
      return byCity.get(city);
    },
    [byCity]
  );

  return { options, loading, search, searchValue, initSearchFromText, resolvePostalCode };
}
