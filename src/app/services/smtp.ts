import type { Settings } from '../types';

export function isSmtpConfigured(settings: Pick<Settings, 'smtpHost' | 'smtpPort' | 'smtpFrom'>): boolean {
  return !!settings.smtpHost?.trim() && Number(settings.smtpPort) > 0 && !!settings.smtpFrom?.trim();
}
