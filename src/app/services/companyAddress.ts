import type { Settings } from '../types';

function normalizePart(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function formatCompanyAddressLine2(settings: Pick<Settings, 'companyPostalCode' | 'companyCity'>): string {
  const postal = normalizePart(settings.companyPostalCode);
  const city = normalizePart(settings.companyCity);
  return [postal, city].filter(Boolean).join(' ');
}

export function formatCompanyAddressMultiline(settings: Pick<Settings, 'companyAddressLine' | 'companyPostalCode' | 'companyCity'>): string {
  const line1 = normalizePart(settings.companyAddressLine);
  const line2 = formatCompanyAddressLine2(settings);
  return [line1, line2].filter(Boolean).join('\n');
}
