import { invoke } from '@tauri-apps/api/core';

export type SerbiaCityDto = {
  city: string;
  postalCode: string;
};

export type SerbiaCityOption = {
  label: string;
  value: string;
  city: string;
  postalCode: string;
};

export async function listSerbiaCities(search?: string): Promise<SerbiaCityDto[]> {
  return invoke<SerbiaCityDto[]>('list_serbia_cities', { search });
}

export function toSerbiaCityOptions(rows: SerbiaCityDto[]): SerbiaCityOption[] {
  return rows.map((r) => ({
    city: r.city,
    postalCode: r.postalCode,
    label: `${r.postalCode} ${r.city}`.trim(),
    value: r.postalCode,
  }));
}
