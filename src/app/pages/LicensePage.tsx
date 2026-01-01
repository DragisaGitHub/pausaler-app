import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Typography, message } from 'antd';
import { CopyOutlined, KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { generateActivationCode, getLicenseStatus, getStoredLicense, validateAndStoreLicense } from '../services/licenseService';
import type { LicenseStatus } from '../types/license';
import { getDevForcedLockInfo, setDevForcedLockLevelPersisted } from '../services/devLockService';
import type { LockLevel } from '../types/license';
import { HARD_BLOCKED, VIEW_ONLY_ALLOWED, VIEW_ONLY_BLOCKED } from '../services/lockAudit';
import { ensureTrialHydrated, getTrialInfo } from '../services/trialService';

function msToDays(ms: number): number {
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function LicensePage() {
  const { t } = useTranslation();

  const [statusText, setStatusText] = useState('');
  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  const [devLockInfoText, setDevLockInfoText] = useState<string | null>(null);
  const [devLockInfoLoading, setDevLockInfoLoading] = useState(false);
  const [lockAuditOpen, setLockAuditOpen] = useState(false);

  const [activationCode, setActivationCode] = useState('');
  const [generating, setGenerating] = useState(false);

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
      await ensureTrialHydrated();
      const s = await getLicenseStatus();
      setStatus(s);

      if (s.isLicensed) {
        setStatusText(
          s.validUntil ? t('license.statusLicensedUntil', { until: s.validUntil }) : t('license.statusLicensed')
        );
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
    void refresh();
  }, []);

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
        </Space>
      </Card>

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
    </div>
  );
}
