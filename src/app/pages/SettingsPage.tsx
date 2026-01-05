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

export function SettingsPage() {
  const { t } = useTranslation();
  const [form] = Form.useForm<Settings>();
  const { settings, loading, save } = useSettings();
  const [logoUrl, setLogoUrl] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const serbiaCities = useSerbiaCities();

  const { status } = useLicenseGate();
  const canWriteSettings = isFeatureAllowed(status, 'SETTINGS_WRITE');

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
  }, [form, settings]);

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
      await save({ ...values, logoUrl });
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
                        name="companyCity"
                        rules={[{ required: true, message: t('settings.companyCityReq') }]}
                      >
                        <Select<string, SerbiaCitySelectOption>
                          showSearch
                          allowClear
                          placeholder={t('settings.companyCityPlaceholder')}
                          loading={serbiaCities.loading}
                          options={serbiaCities.options}
                          filterOption={false}
                          onSearch={serbiaCities.search}
                          onClear={() => {
                            form.setFieldValue('companyPostalCode', '');
                          }}
                          onSelect={(_, option) => {
                            const opt = Array.isArray(option) ? option[0] : option;
                            const postalCode = String(opt?.postalCode ?? '').trim();
                            if (postalCode) {
                              form.setFieldValue('companyPostalCode', postalCode);
                            }
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

                      <Form.Item label={t('settings.smtpPassword')} name="smtpPassword">
                        <Input.Password placeholder={t('settings.smtpPasswordPlaceholder')} />
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