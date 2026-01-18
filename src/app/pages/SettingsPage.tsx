import { useEffect, useMemo, useState } from 'react';
import { Alert, Collapse, Descriptions, Divider, Form, Input, InputNumber, Button, message, Select, Space, Upload, Switch, Tabs, Typography } from 'antd';
import { SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { InfoCircleOutlined, MailOutlined } from '@ant-design/icons';
import { Settings, CURRENCY_VALUES } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from '../i18n';
import { useSerbiaCities, type SerbiaCitySelectOption } from '../hooks/useSerbiaCities';
import { useLicenseGate } from '../components/LicenseGate';
import { isFeatureAllowed } from '../services/featureGate';
import { isSmtpConfigured } from '../services/smtp';
import { sendTestEmail } from '../services/smtpTest';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { checkForUpdatesCached, type UpdateManifest } from '../services/updateService.ts';
import { createBackupArchive, inspectBackupArchive, pickBackupOpenPath, pickBackupSavePath, quitApp, stageRestoreArchive, getLastBackupMetadata, type LastBackupInfo } from '../services/backupService';

function sanitizeSmtpPassword(value: string): string {
  return value.replace(/\s+/g, '');
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [form] = Form.useForm<Settings>();
  const { settings, loading, save } = useSettings();
  const [logoUrl, setLogoUrl] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState<string>('company');
  const serbiaCities = useSerbiaCities();
  // SMTP password UX state
  const [smtpPasswordSaved, setSmtpPasswordSaved] = useState(false);
  const [smtpEditMode, setSmtpEditMode] = useState(false);

  const [appVersion, setAppVersion] = useState<string>('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState<string>('');
  const [latestManifest, setLatestManifest] = useState<UpdateManifest | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [nsisUrl, setNsisUrl] = useState<string>('');
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);

  const { status } = useLicenseGate();
  const canWriteSettings = isFeatureAllowed(status, 'SETTINGS_WRITE');
  const licenseActive = status?.isLicensed === true;

  const smtpHost = Form.useWatch('smtpHost', form);
  const smtpPort = Form.useWatch('smtpPort', form);
  const smtpFrom = Form.useWatch('smtpFrom', form);

  const smtpActive = useMemo(() => {
    return isSmtpConfigured({
      smtpHost: String(smtpHost ?? ''),
      smtpPort: Number(smtpPort ?? 0),
      smtpFrom: String(smtpFrom ?? ''),
    });
  }, [smtpHost, smtpPort, smtpFrom]);

  const handleTestEmail = async () => {
    if (!canWriteSettings) {
      message.error(t('settings.emailHelp.viewOnlyNote'));
      return;
    }
    if (testingEmail) return;

    const current = form.getFieldValue('smtpPassword');
    const sanitized = sanitizeSmtpPassword(String(current ?? ''));
    if (sanitized !== String(current ?? '')) {
      form.setFieldValue('smtpPassword', sanitized);
    }

    setTestingEmail(true);
    try {
      await sendTestEmail();
      message.success(t('settings.emailHelp.testSuccess'));
    } catch (e: any) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : String(e);
      message.error(t('settings.emailHelp.testError', { message: msg }));
    } finally {
      setTestingEmail(false);
    }
  };

  useEffect(() => {
    if (!settings) return;
    const next: any = { ...settings };
    if (!next.smtpTlsMode) {
      next.smtpTlsMode = next.smtpPort === 465 ? 'implicit' : 'starttls';
    }
    form.setFieldsValue(next);
    setLogoUrl(settings.logoUrl || '');
    // Derive whether password exists; do not prefill password field for security
    const hasPwd = !!String(settings.smtpPassword ?? '').trim();
    setSmtpPasswordSaved(hasPwd);
    setSmtpEditMode(false);
    form.setFieldValue('smtpPassword', '');
    // Initialize derived Select field with postal code when available
    const pc = String(settings.companyPostalCode ?? '').trim();
    if (pc) {
      form.setFieldValue('companyCityObj' as any, pc);
    }
  }, [form, settings]);

  useEffect(() => {
    let mounted = true;
    void getVersion()
      .then((v) => {
        if (!mounted) return;
        setAppVersion(String(v ?? ''));
      })
      .catch(() => {
        if (!mounted) return;
        setAppVersion('');
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return;
  }, []);

  const [lastBackup, setLastBackup] = useState<LastBackupInfo | null>(null);
  useEffect(() => {
    if (activeTabKey !== 'backup') return;
    let mounted = true;
    void (async () => {
      try {
        const info = await getLastBackupMetadata();
        if (!mounted) return;
        setLastBackup(info);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [activeTabKey]);

  const formatBackupWhen = (lang: string, iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (lang.startsWith('en')) {
      const mnames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const m = mnames[d.getMonth()];
      const day = String(d.getDate()).padStart(2, '0');
      const yr = d.getFullYear();
      return `${m} ${day}, ${yr} ${hh}:${mm}`;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const yr = d.getFullYear();
    return `${day}.${mo}.${yr} ${hh}:${mm}`;
  };

  const handleCheckUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    setUpdateError('');
    setLatestManifest(null);
    setUpdateAvailable(false);
    setNsisUrl('');
    try {
      const current = appVersion || (await getVersion());
      const res = await checkForUpdatesCached(String(current ?? ''), { timeoutMs: 8000, force: true });
      setLatestManifest(res.latest);
      setUpdateAvailable(res.updateAvailable);
      setNsisUrl(res.nsisUrl ? res.nsisUrl : '');
    } catch (e: any) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      setUpdateError(msg || t('settings.updates.errorGeneric'));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const GITHUB_RELEASES_LATEST_URL = 'https://github.com/DragisaGitHub/pausaler-app/releases/latest';

  const handleOpenDownload = async () => {
    const url = String(nsisUrl || latestManifest?.windows?.nsis || GITHUB_RELEASES_LATEST_URL).trim();
    try {
      await open(url);
    } catch (e: any) {
      try {
        await navigator.clipboard.writeText(url);
        message.success('Link je kopiran.');
      } catch {
        const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
        message.error(msg || t('settings.updates.errorDownloadOrLaunch'));
      }
    }
  };

  const handleUpdateNow = async () => {
    if (downloadingUpdate) return;
    setDownloadingUpdate(true);
    try {
      await handleOpenDownload();
      message.info('Preuzmite instalaciju, zatvorite aplikaciju i pokrenite installer.');
    } finally {
      setDownloadingUpdate(false);
    }
  };

  useEffect(() => {
    if (activeTabKey !== 'aboutUpdates') return;

    void (async () => {
      try {
        const current = appVersion || (await getVersion());
        const res = await checkForUpdatesCached(String(current ?? ''), {
          timeoutMs: 8000,
          force: false,
          maxAgeMs: 6 * 60 * 60 * 1000,
        });
        setLatestManifest(res.latest);
        setUpdateAvailable(res.updateAvailable);
        setNsisUrl(res.nsisUrl ? res.nsisUrl : '');
      } catch {
      }
    })();
  }, [activeTabKey, appVersion]);

  const applyDefaultTlsModeForPort = (port: number | null) => {
    if (!port) return;
    if (port === 465) form.setFieldValue('smtpTlsMode', 'implicit');
    if (port === 587) form.setFieldValue('smtpTlsMode', 'starttls');
  };

  const handleSubmit = async (values: Settings) => {
    try {
      if (!canWriteSettings) {
        message.error(t('license.lockedDescription'));
        return;
      }
      const sanitizedSmtpPassword = sanitizeSmtpPassword(String(values.smtpPassword ?? ''));
      await save({ ...values, smtpPassword: sanitizedSmtpPassword, logoUrl });
      message.success(t('settings.saved'));
      await i18n.changeLanguage(normalizeLanguage(values.language));
    } catch {
      message.error(t('settings.saveError'));
    }
  };

  const handleLogoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setLogoUrl(dataUrl);
      message.success(t('settings.logoLoaded'));
    };
    reader.readAsDataURL(file);
    return false;
  };

  return (
      <div style={{ maxWidth: '100%', minHeight: 'calc(100vh - 220px)' }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          size="large"
          disabled={!canWriteSettings}
          style={{ paddingBottom: 128, display: 'flex', flexDirection: 'column' }}
        >
          <Tabs
            defaultActiveKey="company"
            onChange={(k) => setActiveTabKey(String(k))}
            style={{ flex: 1 }}
            items={[
              {
                key: 'company',
                label: t('settings.companyCard'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Form.Item
                      label={t('settings.companyName')}
                      name="companyName"
                      rules={[{ required: true, message: t('settings.companyNameReq') }]}
                    >
                      <Input placeholder={t('settings.companyNamePlaceholder')} />
                    </Form.Item>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item
                        label={t('settings.vatId')}
                        name="pib"
                        rules={[{ required: true, message: t('settings.vatReq') }]}
                      >
                        <Input placeholder="123456789" />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.companyRegNumber')}
                        name="registrationNumber"
                        rules={[{ required: true, message: t('settings.companyRegNumberReq') }]}
                      >
                        <Input placeholder="12345678" />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.bankAccount')}
                        name="bankAccount"
                        rules={[{ required: true, message: t('settings.bankReq') }]}
                      >
                        <Input placeholder="160-5100000000000-00" />
                      </Form.Item>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item
                        label={t('settings.companyAddressLine')}
                        name="companyAddressLine"
                        rules={[{ required: true, message: t('settings.companyAddressLineReq') }]}
                        style={{ gridColumn: '1 / -1' }}
                      >
                        <Input placeholder={t('settings.companyAddressLinePlaceholder')} />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.companyCity')}
                        name="companyCityObj"
                        rules={[{ required: true, message: t('settings.companyCityReq') }]}
                      >
                        <Select<string, SerbiaCitySelectOption>
                          showSearch
                          allowClear
                          placeholder={t('settings.companyCityPlaceholder')}
                          loading={serbiaCities.loading}
                          options={serbiaCities.options}
                          filterOption={false}
                          searchValue={serbiaCities.searchValue}
                          onDropdownVisibleChange={(open) => {
                            if (open) {
                              const currentCity = String(form.getFieldValue('companyCity') ?? '');
                              serbiaCities.initSearchFromText(currentCity);
                            }
                          }}
                          onSearch={serbiaCities.search}
                          onClear={() => {
                            form.setFieldValue('companyCity', '');
                            form.setFieldValue('companyPostalCode', '');
                            serbiaCities.search('');
                          }}
                          onSelect={(_, option) => {
                            const opt = Array.isArray(option) ? (option[0] as SerbiaCitySelectOption) : (option as SerbiaCitySelectOption);
                            form.setFieldValue('companyCity', opt.city);
                            form.setFieldValue('companyPostalCode', opt.postalCode);
                          }}
                        />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.companyPostalCode')}
                        name="companyPostalCode"
                        rules={[
                          { required: true, message: t('settings.companyPostalCodeReq') },
                          () => ({
                            validator(_, value) {
                              const v = String(value ?? '').trim();
                              if (!v) return Promise.resolve();
                              if (!/^[0-9-]+$/.test(v)) {
                                return Promise.reject(new Error(t('settings.companyPostalCodeInvalid')));
                              }
                              return Promise.resolve();
                            },
                          }),
                        ]}
                      >
                        <Input placeholder={t('settings.companyPostalCodePlaceholder')} />
                      </Form.Item>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item
                        label={t('settings.companyEmail')}
                        name="companyEmail"
                        rules={[{ type: 'email', message: t('settings.companyEmailInvalid') }]}
                      >
                        <Input placeholder={t('settings.companyEmailPlaceholder')} />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.companyPhone')}
                        name="companyPhone"
                        rules={[
                          () => ({
                            validator(_, value) {
                              const raw = String(value ?? '').trim();
                              if (!raw) return Promise.resolve();
                              const compact = raw.replace(/[\s\-()]/g, '');
                              if (compact.length < 6) {
                                return Promise.reject(new Error(t('settings.companyPhoneInvalid')));
                              }
                              return Promise.resolve();
                            },
                          }),
                        ]}
                      >
                        <Input placeholder={t('settings.companyPhonePlaceholder')} />
                      </Form.Item>
                    </div>

                    <Form.Item label={t('settings.logo')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Upload accept="image/*" beforeUpload={handleLogoUpload} showUploadList={false}>
                          <Button icon={<UploadOutlined />}>{t('settings.uploadLogo')}</Button>
                        </Upload>

                        {logoUrl && (
                          <div>
                            <img
                              src={logoUrl}
                              alt="Company logo"
                              style={{ maxHeight: 80, maxWidth: 200, objectFit: 'contain' }}
                            />
                            <Button
                              type="link"
                              danger
                              onClick={() => {
                                setLogoUrl('');
                                message.success(t('settings.logoRemoved'));
                              }}
                            >
                              {t('settings.removeLogo')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: 'backup',
                label: t('settings.backup.tab'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Typography.Title level={4} style={{ marginTop: 0 }}>{t('settings.backup.createTitle')}</Typography.Title>
                    <Space wrap style={{ marginBottom: 12 }}>
                      <Button
                        onClick={async () => {
                          const today = new Date();
                          const yyyy = today.getFullYear();
                          const mm = String(today.getMonth() + 1).padStart(2, '0');
                          const dd = String(today.getDate()).padStart(2, '0');
                          const defaultName = `pausaler-backup-${yyyy}-${mm}-${dd}.pausaler-backup`;
                          const dest = await pickBackupSavePath(defaultName);
                          if (!dest) return;
                          try {
                            const res = await createBackupArchive(dest);
                            message.success(t('settings.backup.createdToast', { path: res.path, sizeKb: Math.round(res.sizeBytes / 1024) }));
                            try {
                              const info = await getLastBackupMetadata();
                              setLastBackup(info);
                            } catch {}
                          } catch (e: any) {
                            const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
                            message.error(msg || t('settings.backup.createError'));
                          }
                        }}
                        disabled={!canWriteSettings}
                      >
                        {t('settings.backup.createButton')}
                      </Button>
                      <Typography.Text type="secondary">{t('settings.backup.createHelp')}</Typography.Text>
                      <div style={{ width: '100%' }} />
                      <Typography.Text type="secondary">
                        {lastBackup
                          ? (lastBackup.missing
                              ? t('settings.backup.last.missing')
                              : t('settings.backup.last.info', {
                                  when: formatBackupWhen(normalizeLanguage(i18n.language), lastBackup.createdAt),
                                  file: String(lastBackup.path).split(/[\\/]/).pop() || '',
                                  sizeKb: Math.round(lastBackup.sizeBytes / 1024),
                                }))
                          : t('settings.backup.last.none')}
                      </Typography.Text>
                    </Space>

                    <Divider style={{ margin: '12px 0' }} />

                    <Typography.Title level={4} style={{ marginTop: 0 }}>{t('settings.backup.restoreTitle')}</Typography.Title>
                    <Space wrap style={{ marginBottom: 12 }}>
                      <Button
                        onClick={async () => {
                          const path = await pickBackupOpenPath();
                          if (!path) return;
                          try {
                            const meta = await inspectBackupArchive(path);
                            const confirmed = await new Promise<boolean>((resolve) => {
                              const key = 'backup-restore-confirm';
                              const content = (
                                <div>
                                  <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
                                    <Descriptions.Item label={t('settings.backup.restoreConfirmCreatedAt')}>{meta.createdAt || '-'}</Descriptions.Item>
                                    <Descriptions.Item label={t('settings.backup.restoreConfirmAppVersion')}>{meta.appVersion || '-'}</Descriptions.Item>
                                    <Descriptions.Item label={t('settings.backup.restoreConfirmPlatform')}>{meta.platform || '-'}</Descriptions.Item>
                                    <Descriptions.Item label={t('settings.backup.restoreConfirmArchiveFormat')}>{String(meta.archiveFormatVersion)}</Descriptions.Item>
                                  </Descriptions>
                                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                                    {t('settings.backup.restoreStaged')}
                                  </Typography.Paragraph>
                                  <Space>
                                    <Button type="primary" onClick={() => { message.destroy(key); resolve(true); }}>{t('settings.backup.restoreConfirmApplyButton')}</Button>
                                    <Button onClick={() => { message.destroy(key); resolve(false); }}>{t('common.cancel')}</Button>
                                  </Space>
                                </div>
                              );
                              message.open({ key, type: 'info', content, duration: 0 });
                            });
                            if (!confirmed) return;
                            const staged = await stageRestoreArchive(path);
                            if (staged.requiresRestart) {
                              message.success(t('settings.backup.restoreStaged'));
                              await quitApp();
                            }
                          } catch (e: any) {
                            const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
                            message.error(msg || t('settings.backup.restoreStageError'));
                          }
                        }}
                        disabled={!canWriteSettings}
                      >
                        {t('settings.backup.restoreButton')}
                      </Button>
                      <Typography.Text type="secondary">{t('settings.backup.restoreHelp')}</Typography.Text>
                    </Space>
                  </div>
                ),
              },
              {
                key: 'invoices',
                label: t('settings.invoicesCard'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                      <Form.Item
                        label={t('settings.invoicePrefix')}
                        name="invoicePrefix"
                        rules={[{ required: true, message: t('settings.prefixReq') }]}
                      >
                        <Input placeholder="INV" />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.nextNumber')}
                        name="nextInvoiceNumber"
                        rules={[{ required: true, message: t('settings.nextReq') }]}
                      >
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.defaultCurrency')}
                        name="defaultCurrency"
                        rules={[{ required: true, message: t('settings.currencyReq') }]}
                      >
                        <Select options={CURRENCY_VALUES.map((c) => ({ value: c, label: t(`currencies.${c}`) }))} />
                      </Form.Item>
                    </div>

                    <div style={{ padding: 16, background: '#f5f5f5', borderRadius: 8, marginTop: 16 }}>
                      <strong>{t('settings.example')}:</strong>{' '}
                      {form.getFieldValue('invoicePrefix') || 'INV'}-
                      {(form.getFieldValue('nextInvoiceNumber') || 1).toString().padStart(4, '0')}
                    </div>
                  </div>
                ),
              },
              {
                key: 'email',
                label: t('settings.emailCard'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item label={t('settings.smtpHost')} name="smtpHost">
                        <Input placeholder={t('settings.smtpHostPlaceholder')} />
                      </Form.Item>

                      <Form.Item label={t('settings.smtpPort')} name="smtpPort">
                        <InputNumber
                          min={1}
                          max={65535}
                          style={{ width: '100%' }}
                          placeholder={t('settings.smtpPortPlaceholder')}
                          onChange={(value) => applyDefaultTlsModeForPort(typeof value === 'number' ? value : null)}
                        />
                      </Form.Item>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <Form.Item label={t('settings.smtpUser')} name="smtpUser">
                        <Input placeholder={t('settings.smtpUserPlaceholder')} />
                      </Form.Item>

                      <Form.Item
                        label={t('settings.smtpPassword')}
                        name="smtpPassword"
                        extra={
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>Razmaci u lozinci se automatski uklanjaju.</span>
                            {smtpPasswordSaved && !smtpEditMode ? (
                              <span style={{ color: '#52c41a' }}>{t('settings.emailHelp.passwordAlreadySaved') || 'SMTP lozinka je sačuvana.'}</span>
                            ) : null}
                          </div>
                        }
                        getValueFromEvent={(e) => sanitizeSmtpPassword(String(e?.target?.value ?? ''))}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Input.Password
                            placeholder={t('settings.smtpPasswordPlaceholder')}
                            disabled={smtpPasswordSaved && !smtpEditMode}
                          />
                          {smtpPasswordSaved && !smtpEditMode ? (
                            <Button
                              size="small"
                              onClick={() => {
                                setSmtpEditMode(true);
                                form.setFieldValue('smtpPassword', '');
                              }}
                            >
                              {t('settings.emailHelp.replacePassword') || 'Zameni lozinku'}
                            </Button>
                          ) : null}
                        </div>
                      </Form.Item>
                    </div>

                    <Form.Item label={t('settings.smtpFrom')} name="smtpFrom">
                      <Input placeholder={t('settings.smtpFromPlaceholder')} />
                    </Form.Item>

                    <Form.Item dependencies={['smtpUseTls']} noStyle>
                      {({ getFieldValue }) => (
                        <Form.Item
                          label={t('settings.smtpTlsMode')}
                          name="smtpTlsMode"
                          extra={t('settings.smtpTlsModeHelp')}
                          dependencies={['smtpUseTls', 'smtpPort']}
                          rules={[
                            ({ getFieldValue }) => ({
                              validator(_, value) {
                                const useTls = !!getFieldValue('smtpUseTls');
                                if (!useTls) return Promise.resolve();
                                if (value !== 'implicit' && value !== 'starttls') {
                                  return Promise.reject(new Error(t('settings.smtpTlsModeReq')));
                                }
                                const port = Number(getFieldValue('smtpPort'));
                                if (port === 465 && value !== 'implicit') {
                                  return Promise.reject(new Error(t('settings.smtpTlsModeMismatch465')));
                                }
                                if (port === 587 && value !== 'starttls') {
                                  return Promise.reject(new Error(t('settings.smtpTlsModeMismatch587')));
                                }
                                return Promise.resolve();
                              },
                            }),
                          ]}
                        >
                          <Select
                            disabled={!getFieldValue('smtpUseTls')}
                            options={[
                              { value: 'implicit', label: t('settings.smtpTlsModeImplicit') },
                              { value: 'starttls', label: t('settings.smtpTlsModeStarttls') },
                            ]}
                          />
                        </Form.Item>
                      )}
                    </Form.Item>

                    <Form.Item label={t('settings.smtpUseTls')} name="smtpUseTls" valuePropName="checked">
                      <Switch />
                    </Form.Item>

                    <Divider style={{ margin: '12px 0' }} />

                    {!smtpActive ? (
                      <Alert
                        type="warning"
                        showIcon
                        icon={<InfoCircleOutlined />}
                        message={t('settings.emailHelp.notConfiguredWarning')}
                        style={{ marginBottom: 12 }}
                      />
                    ) : null}

                    <Space wrap style={{ marginBottom: 12 }}>
                      <Button
                        icon={<MailOutlined />}
                        onClick={() => void handleTestEmail()}
                        loading={testingEmail}
                        disabled={!canWriteSettings}
                      >
                        {t('settings.emailHelp.testButton')}
                      </Button>
                      <Typography.Text type="secondary">{t('settings.emailHelp.testHelp')}</Typography.Text>
                    </Space>

                    <Collapse
                      items={[
                        {
                          key: 'emailHelp',
                          label: t('settings.emailHelp.title'),
                          children: (
                            <div>
                              <Typography.Paragraph style={{ marginTop: 0 }}>
                                {t('settings.emailHelp.intro')}
                              </Typography.Paragraph>

                              {!canWriteSettings ? (
                                <Alert
                                  type="info"
                                  showIcon
                                  icon={<InfoCircleOutlined />}
                                  message={t('settings.emailHelp.viewOnlyNote')}
                                  style={{ marginBottom: 12 }}
                                />
                              ) : null}

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                {t('settings.emailHelp.providersTitle')}
                              </Typography.Title>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                                <Descriptions size="small" bordered column={1} title={t('settings.emailHelp.provider.yahoo.title')}>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.host')}>smtp.mail.yahoo.com</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.port')}>587</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.tls')}>{t('settings.emailHelp.providerValues.tlsStarttls')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.user')}>{t('settings.emailHelp.providerValues.userFullEmail')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.pass')}>{t('settings.emailHelp.providerValues.passAppPassword')}</Descriptions.Item>
                                </Descriptions>

                                <Descriptions size="small" bordered column={1} title={t('settings.emailHelp.provider.gmail.title')}>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.host')}>smtp.gmail.com</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.port')}>587</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.tls')}>{t('settings.emailHelp.providerValues.tlsStarttls')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.user')}>{t('settings.emailHelp.providerValues.userFullEmail')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.pass')}>{t('settings.emailHelp.providerValues.gmailRequiresAppPassword')}</Descriptions.Item>
                                </Descriptions>

                                <Descriptions size="small" bordered column={1} title={t('settings.emailHelp.provider.outlook.title')}>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.host')}>smtp.office365.com</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.port')}>587</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.tls')}>{t('settings.emailHelp.providerValues.tlsStarttls')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.user')}>{t('settings.emailHelp.providerValues.userFullEmail')}</Descriptions.Item>
                                  <Descriptions.Item label={t('settings.emailHelp.providerFields.pass')}>{t('settings.emailHelp.providerValues.passAppPassword')}</Descriptions.Item>
                                </Descriptions>
                              </div>

                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                {t('settings.emailHelp.appPasswordTitle')}
                              </Typography.Title>
                              <Typography.Paragraph style={{ marginBottom: 12 }}>
                                {t('settings.emailHelp.appPasswordBody')}
                              </Typography.Paragraph>

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                {t('settings.emailHelp.fieldsTitle')}
                              </Typography.Title>
                              <ul style={{ marginTop: 8 }}>
                                <li>{t('settings.emailHelp.fields.smtpHost')}</li>
                                <li>{t('settings.emailHelp.fields.smtpPort')}</li>
                                <li>{t('settings.emailHelp.fields.smtpUser')}</li>
                                <li>{t('settings.emailHelp.fields.smtpPassword')}</li>
                                <li>{t('settings.emailHelp.fields.smtpFrom')}</li>
                                <li>{t('settings.emailHelp.fields.smtpTlsMode')}</li>
                                <li>{t('settings.emailHelp.fields.smtpUseTls')}</li>
                              </ul>

                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                {t('settings.emailHelp.securityTitle')}
                              </Typography.Title>
                              <Typography.Paragraph style={{ marginBottom: 0 }}>
                                {t('settings.emailHelp.securityBody')}
                              </Typography.Paragraph>
                            </div>
                          ),
                        },
                        {
                          key: 'gmailExtraHelp',
                          label: 'Gmail – dodatna pojašnjenja',
                          children: (
                            <div>
                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                Gmail – App Password wizard za korisnike bez tehničkog iskustva
                              </Typography.Title>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>A) KORAK 1 – Provera preduslova</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Korisnik mora imati lični gmail.com nalog.</li>
                                <li>Mora biti uključena potvrda u dva koraka (2-Step Verification).</li>
                                <li>Bez ove zaštite Gmail neće dozvoliti pravljenje lozinke za aplikaciju.</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>B) KORAK 2 – Uključivanje verifikacije u 2 koraka</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Otvorite desktop browser (Chrome ili Edge).</li>
                                <li>
                                  Idite na:{' '}
                                  <Typography.Link href="https://myaccount.google.com" target="_blank" rel="noreferrer">
                                    https://myaccount.google.com
                                  </Typography.Link>
                                </li>
                                <li>Levo izaberite: Bezbednost</li>
                                <li>Otvorite: Verifikacija u 2 koraka</li>
                                <li>Pratite Google korake da uključite 2FA putem telefona ili Google Prompt metode.</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>C) KORAK 3 – Kreiranje App Password</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>
                                  Otvorite direktno u browseru:{' '}
                                  <Typography.Link href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                                    https://myaccount.google.com/apppasswords
                                  </Typography.Link>
                                </li>
                                <li>Prijavite se na Gmail nalog ako Google to zatraži.</li>
                                <li>U polju za naziv upišite: Pausaler</li>
                                <li>Kliknite: Create / Kreiraj</li>
                                <li>Google prikaže novu lozinku za aplikaciju.</li>
                                <li>Kopirajte je i nalepite u polje “SMTP lozinka” u aplikaciji.</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>D) KORAK 4 – Ispravan copy/paste postupak</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Nakon paste uključite “Prikaži lozinku” (ikona oka).</li>
                                <li>Proverite da li unesena vrednost sadrži razmake.</li>
                                <li>OBRIŠITE SVE RAZMAKE iz lozinke.</li>
                                <li>Kliknite “Sačuvaj podešavanja”.</li>
                                <li>Tek onda koristite dugme “Testiraj email podešavanja”.</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>E) SMTP podešavanja za Gmail (primer za unos)</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>SMTP host: smtp.gmail.com</li>
                                <li>SMTP port: 587</li>
                                <li>TLS režim: STARTTLS</li>
                                <li>SMTP korisnik: puna Gmail adresa</li>
                                <li>SMTP lozinka: App Password bez razmaka</li>
                              </ul>

                              <Descriptions size="small" bordered column={1} title="Polje | Vrednost">
                                <Descriptions.Item label="SMTP host">smtp.gmail.com</Descriptions.Item>
                                <Descriptions.Item label="SMTP port">587</Descriptions.Item>
                                <Descriptions.Item label="TLS režim">STARTTLS</Descriptions.Item>
                                <Descriptions.Item label="SMTP korisnik">puna Gmail adresa</Descriptions.Item>
                                <Descriptions.Item label="SMTP lozinka">App Password bez razmaka</Descriptions.Item>
                              </Descriptions>

                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>F) Troubleshooting</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Ako opcija nije bila vidljiva, direktan URL uvek otvara ekran za lozinke.</li>
                                <li>App Password mora biti vezan za isti Gmail nalog koji je username.</li>
                                <li>Više testiranja sa pogrešnom vrednošću zaključava nalog (#AUTH005).</li>
                                <li>Posle greške sačekati i pokušati ponovo samo nakon brisanja razmaka.</li>
                              </ul>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>G) Bezbednost</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 0 }}>
                                <li>Lozinka se čuva samo lokalno u aplikaciji.</li>
                                <li>Ne šalje se na cloud niti na druge servere.</li>
                                <li>Koristi se isključivo za Gmail SMTP vezu.</li>
                              </ul>

                              <Divider style={{ margin: '12px 0' }} />
                              <Typography.Paragraph style={{ marginBottom: 0 }}>
                                <Typography.Text type="secondary">Yahoo guide will be added later.</Typography.Text>
                              </Typography.Paragraph>
                            </div>
                          ),
                        },
                        {
                          key: 'yahooExtraHelp',
                          label: 'Yahoo – podešavanje slanja (App Password)',
                          children: (
                            <div>
                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Title level={5} style={{ marginTop: 0 }}>
                                Yahoo – podešavanje slanja (App Password)
                              </Typography.Title>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>A) Preduslov</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Potreban je Yahoo mail nalog (npr. ime@yahoo.com).</li>
                                <li>Yahoo za slanje iz aplikacije zahteva “App Password” (ne koristi se obična lozinka naloga).</li>
                              </ul>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>B) Korak 1 – Uđite u bezbednosna podešavanja naloga</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Otvorite desktop browser (Chrome/Edge).</li>
                                <li>Ulogujte se u Yahoo nalog.</li>
                                <li>Otvorite podešavanja bezbednosti naloga (Account Security).</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>C) Korak 2 – Napravite Yahoo App Password</Typography.Text>
                              </Typography.Paragraph>
                              <ol style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>U Account Security pronađite opciju “Generate app password” / “Create app password” (naziv može biti različit).</li>
                                <li>Unesite naziv: Pausaler</li>
                                <li>Kliknite Generate / Create</li>
                                <li>Kopirajte dobijenu lozinku i nalepite je u polje “SMTP lozinka” u Pausaler aplikaciji.</li>
                              </ol>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>D) Korak 3 – Unos lozinke (copy/paste)</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Nalepite lozinku u “SMTP lozinka”.</li>
                                <li>Kliknite “Prikaži lozinku” da proverite unos.</li>
                                <li>Ako postoje razmaci ili novi redovi, obrišite ih (aplikacija automatski uklanja razmake).</li>
                                <li>Kliknite “Sačuvaj podešavanja”.</li>
                                <li>Tek onda kliknite “Testiraj email podešavanja”.</li>
                              </ul>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>E) Yahoo SMTP podešavanja (primer za unos)</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>SMTP host: smtp.mail.yahoo.com</li>
                                <li>SMTP port: 587</li>
                                <li>TLS režim: STARTTLS</li>
                                <li>SMTP korisnik: puna Yahoo adresa (npr. ime@yahoo.com)</li>
                                <li>SMTP lozinka: Yahoo App Password</li>
                              </ul>

                              <Descriptions size="small" bordered column={1} title="Polje | Vrednost">
                                <Descriptions.Item label="SMTP host">smtp.mail.yahoo.com</Descriptions.Item>
                                <Descriptions.Item label="SMTP port">587</Descriptions.Item>
                                <Descriptions.Item label="TLS režim">STARTTLS</Descriptions.Item>
                                <Descriptions.Item label="SMTP korisnik">puna Yahoo adresa</Descriptions.Item>
                                <Descriptions.Item label="SMTP lozinka">Yahoo App Password</Descriptions.Item>
                              </Descriptions>

                              <Divider style={{ margin: '12px 0' }} />

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>F) Najčešće greške (Troubleshooting)</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 12 }}>
                                <li>Ne mešajte provajdere: ako je host Yahoo, i SMTP korisnik i “From adresa” treba da budu Yahoo.</li>
                                <li>SMTP korisnik mora biti puna Yahoo adresa.</li>
                                <li>App Password nije isto što i obična lozinka naloga.</li>
                                <li>Ako dobijete grešku 535 / previše pogrešnih pokušaja, sačekajte 15–60 minuta i pokušajte ponovo nakon provere podešavanja.</li>
                              </ul>

                              <Typography.Paragraph style={{ marginTop: 0, marginBottom: 8 }}>
                                <Typography.Text strong>G) Napomena</Typography.Text>
                              </Typography.Paragraph>
                              <ul style={{ marginTop: 0, marginBottom: 0 }}>
                                <li>Ovo uputstvo je za Yahoo.</li>
                                <li>(Kasnije ćemo dodati i druga uputstva po istom principu.)</li>
                              </ul>

                              <Divider style={{ margin: '12px 0' }} />
                            </div>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              },
              {
                key: 'language',
                label: t('settings.languageCard'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Form.Item
                      label={t('settings.language')}
                      name="language"
                      tooltip={t('settings.languageHelp')}
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { value: 'sr', label: t('settings.langSr') },
                          { value: 'en', label: t('settings.langEn') },
                        ]}
                      />
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: 'aboutUpdates',
                label: t('settings.updates.tab'),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Typography.Paragraph style={{ marginTop: 0, marginBottom: 12 }}>
                      <Typography.Text strong>{t('settings.updates.currentVersion')}:</Typography.Text>{' '}
                      <Typography.Text>{appVersion || '-'}</Typography.Text>
                    </Typography.Paragraph>

                    <Space wrap style={{ marginBottom: 12 }}>
                      <Button
                        onClick={() => void handleCheckUpdates()}
                        loading={checkingUpdates}
                        disabled={false}
                      >
                        {t('settings.updates.checkButton')}
                      </Button>
                      <Typography.Text type="secondary">{t('settings.updates.checkHelp')}</Typography.Text>
                    </Space>

                    {latestManifest && updateAvailable ? (
                      <Alert
                        type="info"
                        showIcon
                        message={`Dostupna je nova verzija: ${latestManifest.version}`}
                        action={
                          <Button type="link" onClick={() => void handleOpenDownload()}>
                            Otvori preuzimanje
                          </Button>
                        }
                        style={{ marginBottom: 12 }}
                      />
                    ) : null}

                    {updateError ? (
                      <Alert
                        type="error"
                        showIcon
                        message={t('settings.updates.errorTitle')}
                        description={updateError}
                        style={{ marginBottom: 12 }}
                      />
                    ) : null}

                    {latestManifest && !updateAvailable ? (
                      <Alert
                        type="success"
                        showIcon
                        message={t('settings.updates.upToDate')}
                        style={{ marginBottom: 12 }}
                      />
                    ) : null}

                    {latestManifest && updateAvailable ? (
                      <div>
                        <Alert
                          type={licenseActive ? 'info' : 'warning'}
                          showIcon
                          message={t('settings.updates.availableTitle', { version: latestManifest.version })}
                          description={
                            <div>
                              {!licenseActive ? (
                                <Typography.Paragraph style={{ marginTop: 0, marginBottom: 12 }}>
                                  {t('settings.updates.requiresLicense')}
                                </Typography.Paragraph>
                              ) : null}

                              <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
                                <Descriptions.Item label={t('settings.updates.latestVersion')}>{latestManifest.version}</Descriptions.Item>
                                <Descriptions.Item label={t('settings.updates.releasedAt')}>{latestManifest.releasedAt || '-'}</Descriptions.Item>
                                <Descriptions.Item label={t('settings.updates.releaseNotes')}>
                                  {latestManifest.notes.length ? (
                                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                                      {latestManifest.notes.map((n: string, idx: number) => (
                                        <li key={idx}>
                                          <Typography.Text>{n}</Typography.Text>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <Typography.Text>-</Typography.Text>
                                  )}
                                </Descriptions.Item>
                              </Descriptions>

                              <Space wrap>
                                <Button
                                  type="primary"
                                  onClick={() => void handleUpdateNow()}
                                  disabled={!licenseActive || downloadingUpdate}
                                  loading={downloadingUpdate}
                                >
                                  {t('settings.updates.updateNow')}
                                </Button>
                                {!nsisUrl ? (
                                  <Typography.Text type="secondary">{t('settings.updates.missingInstallerUrl')}</Typography.Text>
                                ) : null}
                              </Space>
                            </div>
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </Form>

        <div
          style={{
            position: 'fixed',
            left: 'calc(var(--app-sider-width, 240px) + 48px)',
            bottom: 24,
            zIndex: 1000,
          }}
        >
          <Button
            type="primary"
            icon={<SaveOutlined />}
            size="large"
            loading={loading}
            disabled={!canWriteSettings}
            onClick={() => form.submit()}
          >
            {t('settings.save')}
          </Button>
        </div>
      </div>
  );
}