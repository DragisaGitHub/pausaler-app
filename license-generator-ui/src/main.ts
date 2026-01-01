import { invoke } from '@tauri-apps/api/core';

type LicenseKind = 'yearly' | 'lifetime';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

const activationEl = $('activation') as HTMLTextAreaElement;
const kindEl = $('kind') as HTMLSelectElement;
const generateEl = $('generate') as HTMLButtonElement;
const copyEl = $('copyLicense') as HTMLButtonElement;
const showPubEl = $('showPub') as HTMLButtonElement;
const licenseEl = $('license') as HTMLTextAreaElement;
const statusEl = $('status') as HTMLDivElement;

function setStatus(msg: string, kind: 'ok' | 'error' | 'info' = 'info') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : ''}`;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

generateEl.addEventListener('click', async () => {
  const activationCode = activationEl.value.trim();
  const licenseType = kindEl.value as LicenseKind;

  if (!activationCode) {
    setStatus('Activation code is required.', 'error');
    return;
  }

  generateEl.disabled = true;
  copyEl.disabled = true;
  setStatus('Generating...', 'info');

  try {
    const license = await invoke<string>('generate_license', {
      args: {
        activationCode,
        licenseType,
      },
    });

    licenseEl.value = license;
    copyEl.disabled = false;
    setStatus('License generated.', 'ok');
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    setStatus(msg, 'error');
  } finally {
    generateEl.disabled = false;
  }
});

copyEl.addEventListener('click', async () => {
  const text = licenseEl.value.trim();
  if (!text) return;
  try {
    await copyToClipboard(text);
    setStatus('Copied license to clipboard.', 'ok');
  } catch {
    setStatus('Failed to copy to clipboard.', 'error');
  }
});

showPubEl.addEventListener('click', async () => {
  try {
    const pem = await invoke<string>('public_key_pem');
    await copyToClipboard(pem);
    setStatus('Public key copied to clipboard.', 'ok');
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    setStatus(msg, 'error');
  }
});
