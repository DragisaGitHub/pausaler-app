import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Radio, Space, Typography, message } from 'antd';
import { CopyOutlined, KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { generateActivationCode, getLicenseStatus, getStoredLicense, validateAndStoreLicense } from '../services/licenseService';
import { getAppMeta, setAppMeta } from '../services/licenseCodeGenerator';
import type { LicenseStatus } from '../types/license';
import { getDevForcedLockInfo, setDevForcedLockLevelPersisted } from '../services/devLockService';
import type { LockLevel } from '../types/license';
import { HARD_BLOCKED, VIEW_ONLY_ALLOWED, VIEW_ONLY_BLOCKED } from '../services/lockAudit';
import { ensureTrialHydrated, getTrialInfo } from '../services/trialService';
import dayjs from 'dayjs';
import { getStorage } from '../services/storageProvider';
import { isSmtpConfigured } from '../services/smtp';
import type { Settings } from '../types';

function msToDays(ms: number): number {
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function LicensePage() {
  const { t } = useTranslation();

  const [statusText, setStatusText] = useState('');
  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [devLockInfoText, setDevLockInfoText] = useState<string | null>(null);
  const [devLockInfoLoading, setDevLockInfoLoading] = useState(false);
  const [lockAuditOpen, setLockAuditOpen] = useState(false);

  const [activationCode, setActivationCode] = useState('');
  const [generating, setGenerating] = useState(false);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailForm] = Form.useForm();
  const [licenseType, setLicenseType] = useState<'YEARLY' | 'LIFETIME'>('YEARLY');
  const LICENSE_TYPE_META_KEY = 'licenseRequestType';
  const [subjectDirty] = useState(false);
  const [bodyDirty] = useState(false);

  const [licenseInput, setLicenseInput] = useState('');
  const [activating, setActivating] = useState(false);

  const trialInfo = getTrialInfo();

  const trialRemainingDays = useMemo(() => {
    if (!trialInfo) return null;
    const endMs = Date.parse(trialInfo.trialEndsAt);
    if (!Number.isFinite(endMs)) return null;
    return msToDays(endMs - Date.now());
  }, [trialInfo]);

  const refresh = async () => {
    setStatusLoading(true);
    try {
      const storage = getStorage();
      const sSettings = await storage.getSettings();
      setSettings(sSettings);

      await ensureTrialHydrated();
      const s = await getLicenseStatus();
      setStatus(s);

      if (s.isLicensed) {
        if (s.validUntil) {
          const d = dayjs(s.validUntil);
          const until = d.isValid() ? d.format('YYYY-MM-DD') : s.validUntil;
          setStatusText(t('license.statusLicensedUntil', { until }));
        } else {
          setStatusText(`${t('license.statusLicensed')} • ${t('license.typeLifetime')}`);
        }
      } else if (s.isTrialActive) {
        if (trialRemainingDays != null) {
          setStatusText(t('license.statusTrial', { days: trialRemainingDays }));
        } else {
          setStatusText(t('license.statusTrialUnknown'));
        }
      } else if (s.lockLevel === 'VIEW_ONLY') {
        setStatusText(t('license.statusViewOnly'));
      } else {
        setStatusText(t('license.statusLocked'));
      }

      const stored = getStoredLicense();
      if (stored && !licenseInput.trim()) {
        setLicenseInput(stored);
      }

      if (import.meta.env.DEV) {
        setDevLockInfoLoading(true);
        try {
          const info = await getDevForcedLockInfo();
          const parts = [
            `Env override: ${info.envLevel ?? 'none'}`,
            `Persisted override: ${info.persistedLevel ?? 'none'}`,
            `Effective: ${info.effectiveLevel ?? 'none'} (${info.effectiveReason ?? 'none'})`,
          ];
          setDevLockInfoText(parts.join(' • '));
        } finally {
          setDevLockInfoLoading(false);
        }
      }
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      // Load persisted license request type (fallback YEARLY)
      try {
        const saved = await getAppMeta(LICENSE_TYPE_META_KEY);
        const v = (saved || '').trim().toUpperCase();
        if (v === 'YEARLY' || v === 'LIFETIME') {
          setLicenseType(v as 'YEARLY' | 'LIFETIME');
        }
      } catch {
        // ignore
      }
      await refresh();
    })();
  }, []);

  const yearlyDaysLeft = useMemo(() => {
    if (!status?.isLicensed || !status.validUntil) return null;
    const d = dayjs(status.validUntil);
    if (!d.isValid()) return null;
    return msToDays(d.valueOf() - Date.now());
  }, [status?.isLicensed, status?.validUntil]);

  const showActivationUI = useMemo(() => {
    if (!status) return true;
    if (!status.isLicensed) return true;
    if (!status.validUntil) return false;
    if (yearlyDaysLeft == null) return true;
    return yearlyDaysLeft <= 7;
  }, [status, yearlyDaysLeft]);

  const doGenerateActivationCode = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const code = await generateActivationCode();
      setActivationCode(code);
      message.success(t('license.activationCodeGenerated'));
    } catch {
      message.error(t('license.activationCodeError'));
    } finally {
      setGenerating(false);
    }
  };

  const doCopy = async () => {
    if (!activationCode) return;
    try {
      await navigator.clipboard.writeText(activationCode);
      message.success(t('license.copied'));
    } catch {
      message.error(t('license.copyError'));
    }
  };

  const doActivate = async () => {
    if (activating) return;
    setActivating(true);
    try {
      const ok = await validateAndStoreLicense(licenseInput);
      if (!ok) {
        message.error(t('license.invalidLicense'));
        return;
      }
      message.success(t('license.activated'));
      await refresh();
    } finally {
      setActivating(false);
    }
  };

  const vendorEmail = useMemo(() => 'dragisa1984@yahoo.com', []);

  const defaultEmailSubject = useMemo(() => {
    const typeLabel = licenseType === 'LIFETIME' ? t('license.typeLifetime') : t('license.typeYearly');
    return `${t('license.emailDefaultSubject')} – ${typeLabel}`;
  }, [t, licenseType]);

  const buildDefaultEmailBody = (): string => {
    const companyName = (settings?.companyName?.trim() || '-') || '-';
    const companyEmail = (settings?.companyEmail?.trim() || '-') || '-';
    const typeLabel = licenseType === 'LIFETIME' ? t('license.typeLifetime') : t('license.typeYearly');
    const code = activationCode || '-';

    const lines: string[] = [];
    // Header and type
    lines.push(t('license.emailRequestHeader'));
    lines.push(`${t('license.emailLicenseType')}: ${typeLabel}`);
    lines.push('');
    // Activation code block
    lines.push(`${t('license.emailActivationCodeHeader')}:`);
    lines.push(code);
    lines.push('');
    // Company details
    lines.push(`${t('license.emailCompanyHeader')}:`);
    lines.push(`${t('license.emailCompanyName')}: ${companyName}`);
    lines.push(`${t('license.emailCompanyEmail')}: ${companyEmail}`);
    return lines.join('\n');
  };

  const openEmailModal = () => {
    if (!settings) return;
    emailForm.setFieldsValue({ note: '' });
    setEmailModalOpen(true);
  };

  function humanReadableError(err: unknown): string {
    const anyErr = err as any;
    const msg = anyErr?.message || anyErr?.toString?.() || String(err);
    if (!msg || msg === '[object Object]') return t('license.emailSendError');
    return msg;
  }

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout while sending email')), ms);
      p
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  const doSendEmail = async () => {
    if (!settings) return;
    try {
      const values = await emailForm.validateFields();
      setEmailSending(true);
      const storage = getStorage();
      const subject = defaultEmailSubject;
      const baseBody = buildDefaultEmailBody();
      const note = (values.note ? String(values.note) : '').trim();
      const body = note ? `${baseBody}\n\n${t('license.emailPersonalNote')}:\n${note}` : baseBody;
      const ok = await withTimeout(
        storage.sendLicenseRequestEmail({ to: vendorEmail, subject, body }),
        20000
      );
      if (ok) {
        message.success(t('license.emailSent'));
        setEmailModalOpen(false);
      } else {
        message.error(t('license.emailSendError'));
      }
    } catch (e) {
      if ((e as any)?.errorFields) {
        // Validation errors already shown by antd.
      } else {
        console.error('License request email send failed:', e);
        const msg = humanReadableError(e);
        message.error(msg.includes('Timeout') ? msg : t('license.emailSendError'));
      }
    } finally {
      setEmailSending(false);
    }
  };

  // Subject/body are generated at send-time; no live syncing needed.

  const setForcedLockLevel = async (level: LockLevel | null) => {
    if (!import.meta.env.DEV) return;
    await setDevForcedLockLevelPersisted(level);
    message.success(level ? `Forced lock set to ${level} (persisted)` : 'Forced lock cleared');
    await refresh();
  };

  const statusReasonText = useMemo(() => {
    if (!status?.reason) return null;
    return String(status.reason);
  }, [status]);

  return (
    <div style={{ maxWidth: 900 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('license.title')}
      </Typography.Title>

      <Alert
        type="info"
        showIcon
        message={t('license.statusTitle')}
        description={statusLoading ? t('common.loading') : statusText}
        style={{ marginBottom: 16 }}
      />

      {showActivationUI ? (
        <Card title={t('license.activationCodeTitle')} style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('license.activationCodeHelp')}
            </Typography.Paragraph>

            <Space>
              <Button icon={<KeyOutlined />} onClick={() => void doGenerateActivationCode()} loading={generating}>
                {t('license.generateActivationCode')}
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => void doCopy()} disabled={!activationCode}>
                {t('license.copy')}
              </Button>
            </Space>

            <Input.TextArea
              value={activationCode}
              readOnly
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder={t('license.activationCodePlaceholder')}
            />

            <Form layout="vertical">
              <Form.Item label={t('license.desiredLicenseTypeLabel')} style={{ marginBottom: 8 }}>
                <Radio.Group
                  value={licenseType}
                  onChange={async (e) => {
                    const v = e.target.value as 'YEARLY' | 'LIFETIME';
                    setLicenseType(v);
                    try { await setAppMeta(LICENSE_TYPE_META_KEY, v); } catch {}
                    // Regenerate defaults if modal is open and fields are not dirty
                    if (emailModalOpen) {
                      if (!subjectDirty) emailForm.setFieldValue('subject', `${t('license.emailDefaultSubject')} – ${v === 'LIFETIME' ? t('license.typeLifetime') : t('license.typeYearly')}`);
                      if (!bodyDirty) emailForm.setFieldValue('body', buildDefaultEmailBody());
                    }
                  }}
                >
                  <Radio value="YEARLY">{t('license.typeYearly')}</Radio>
                  <Radio value="LIFETIME">{t('license.typeLifetime')}</Radio>
                </Radio.Group>
              </Form.Item>
            </Form>

            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('license.sendEmailHelp')}
            </Typography.Paragraph>
            <Space>
              <Button
                onClick={openEmailModal}
                disabled={!activationCode || !settings || !isSmtpConfigured({ smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpFrom: settings.smtpFrom })}
              >
                {t('license.sendEmail')}
              </Button>
              {!settings || !isSmtpConfigured({ smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpFrom: settings.smtpFrom }) ? (
                <Typography.Text type="secondary">{t('license.emailSmtpNotConfigured')}</Typography.Text>
              ) : null}
            </Space>

            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t('license.emailHelperNote')}
            </Typography.Paragraph>
          </Space>
        </Card>
      ) : null}

      {showActivationUI ? (
        <Card title={t('license.enterLicenseTitle')}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('license.enterLicenseHelp')}
            </Typography.Paragraph>

            <Form layout="vertical">
              <Form.Item label={t('license.licenseStringLabel')}>
                <Input.TextArea
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder={t('license.licenseStringPlaceholder')}
                />
              </Form.Item>

              <Space>
                <Button
                  type="primary"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => void doActivate()}
                  loading={activating}
                  disabled={!licenseInput.trim()}
                >
                  {t('license.activate')}
                </Button>
              </Space>
            </Form>

            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t('license.trialLabel')}>
                {trialInfo
                  ? trialInfo.status === 'ACTIVE'
                    ? t('license.trialActive')
                    : t('license.trialExpired')
                  : t('license.trialUnknown')}
              </Descriptions.Item>
              {trialInfo?.trialEndsAt ? (
                <Descriptions.Item label={t('license.trialEndsAt')}>
                  {trialInfo.trialEndsAt}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Space>
        </Card>
      ) : null}

      {import.meta.env.DEV ? (
        <Card title="Dev Tools" style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="warning"
              showIcon
              message="DEV/TEST only"
              description="These overrides are ignored in production builds."
            />

            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Effective locked">
                {status?.isLocked ? 'Yes' : 'No'}
              </Descriptions.Item>
              <Descriptions.Item label="Lock level">
                {status?.lockLevel ?? 'NONE'}
              </Descriptions.Item>
              <Descriptions.Item label="Effective reason">
                {statusReasonText ?? 'none'}
              </Descriptions.Item>
              <Descriptions.Item label="Overrides">
                {devLockInfoLoading ? 'Loading…' : (devLockInfoText ?? 'n/a')}
              </Descriptions.Item>
            </Descriptions>

            <Space wrap>
              <Button danger onClick={() => void setForcedLockLevel('HARD')}>
                Force HARD (persisted)
              </Button>
              <Button onClick={() => void setForcedLockLevel('VIEW_ONLY')}>
                Force VIEW_ONLY (persisted)
              </Button>
              <Button onClick={() => void setForcedLockLevel(null)}>
                Clear Forced Lock
              </Button>
              <Button onClick={() => setLockAuditOpen(true)}>
                Open Lock Audit
              </Button>
            </Space>

            <Typography.Paragraph style={{ marginBottom: 0 }}>
              For env-based forcing in dev: set <Typography.Text code>PAUSALER_FORCE_LOCK_LEVEL=view_only</Typography.Text> or <Typography.Text code>PAUSALER_FORCE_LOCK_LEVEL=hard</Typography.Text> before running <Typography.Text code>yarn tauri dev</Typography.Text>.
            </Typography.Paragraph>

            <Modal
              title="Lock Audit"
              open={lockAuditOpen}
              onCancel={() => setLockAuditOpen(false)}
              footer={null}
            >
              <Typography.Paragraph>
                Quick checklist of features that should be blocked when locked.
              </Typography.Paragraph>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Current locked">
                  {status?.isLocked ? 'LOCKED' : 'UNLOCKED'}
                </Descriptions.Item>
                <Descriptions.Item label="Reason">
                  {statusReasonText ?? 'none'}
                </Descriptions.Item>
              </Descriptions>

              <div style={{ marginTop: 12 }}>
                <Typography.Text strong>VIEW_ONLY expected behavior</Typography.Text>

                <Typography.Paragraph style={{ marginTop: 8, marginBottom: 4 }}>
                  Allowed:
                </Typography.Paragraph>
                <ul style={{ marginTop: 0 }}>
                  {VIEW_ONLY_ALLOWED.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>

                <Typography.Paragraph style={{ marginTop: 8, marginBottom: 4 }}>
                  Blocked:
                </Typography.Paragraph>
                <ul style={{ marginTop: 0 }}>
                  {VIEW_ONLY_BLOCKED.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>

                <Typography.Text strong>HARD expected behavior</Typography.Text>
                <ul style={{ marginTop: 8 }}>
                  {HARD_BLOCKED.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </div>
            </Modal>
          </Space>
        </Card>
      ) : null}

      <Modal
        title={t('license.sendEmailTitle')}
        open={emailModalOpen}
        onCancel={() => setEmailModalOpen(false)}
        okText={t('license.sendEmail')}
        onOk={() => void doSendEmail()}
        confirmLoading={emailSending}
      >
        <Form form={emailForm} layout="vertical">
          <Form.Item label={t('license.emailRecipientLabel')}>
            <Input value={vendorEmail} disabled readOnly />
          </Form.Item>
          <Form.Item name="note" label={t('license.emailNoteLabel')}>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
