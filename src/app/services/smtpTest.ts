import { invoke } from '@tauri-apps/api/core';

export async function sendTestEmail(): Promise<boolean> {
  return invoke<boolean>('send_test_email');
}
