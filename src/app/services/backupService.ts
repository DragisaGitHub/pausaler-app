import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import i18n from '../i18n';

export type BackupResult = {
  path: string;
  sizeBytes: number;
  createdAt: string;
};

export type BackupMetadataResult = {
  appName: string;
  appVersion: string;
  createdAt: string;
  platform: string;
  schemaVersion?: number | null;
  archiveFormatVersion: number;
};

export type RestoreStageResult = {
  stagedAt: string;
  requiresRestart: boolean;
};

export type LastBackupInfo = {
  path: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string;
  archiveFormatVersion: number;
  missing: boolean;
};

export async function pickBackupSavePath(defaultName: string): Promise<string | null> {
  const dest = await save({
    title: i18n.t('settings.backup.saveDialogTitle'),
    filters: [{ name: i18n.t('settings.backup.fileTypeName'), extensions: ['pausaler-backup'] }],
    defaultPath: defaultName.endsWith('.pausaler-backup') ? defaultName : `${defaultName}.pausaler-backup`,
  });
  return dest || null;
}

export async function pickBackupOpenPath(): Promise<string | null> {
  const src = await open({
    title: i18n.t('settings.backup.openDialogTitle'),
    filters: [{ name: i18n.t('settings.backup.fileTypeName'), extensions: ['pausaler-backup'] }],
    multiple: false,
  });
  if (!src) return null;
  return Array.isArray(src) ? src[0] : src;
}

export async function createBackupArchive(destPath: string): Promise<BackupResult> {
  const res = await invoke<BackupResult>('create_backup_archive', { destPath });
  return res;
}

export async function inspectBackupArchive(archivePath: string): Promise<BackupMetadataResult> {
  const res = await invoke<BackupMetadataResult>('inspect_backup_archive', { archivePath });
  return res;
}

export async function stageRestoreArchive(archivePath: string): Promise<RestoreStageResult> {
  const res = await invoke<RestoreStageResult>('stage_restore_archive', { archivePath });
  return res;
}

export async function quitApp(): Promise<void> {
  await invoke('quit_app');
}

export async function getLastBackupMetadata(): Promise<LastBackupInfo | null> {
  try {
    const res = await invoke<LastBackupInfo>('get_last_backup_metadata');
    return res;
  } catch (e: any) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    if (msg === 'NO_LAST_BACKUP') return null;
    return null;
  }
}
