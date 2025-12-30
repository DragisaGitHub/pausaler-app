import { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Button, message, Select, Upload, Switch, Tabs } from 'antd';
import { SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { Settings, CURRENCY_VALUES } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from '../i18n';
import { useSerbiaCities } from '../hooks/useSerbiaCities';

export function SettingsPage() {
  const { t } = useTranslation();
  const [form] = Form.useForm<Settings>();
  const { settings, loading, save } = useSettings();
  const [logoUrl, setLogoUrl] = useState('');
  const serbiaCities = useSerbiaCities();

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
                        <Select
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
                            const postalCode = String((option as any)?.postalCode ?? '').trim();
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
            onClick={() => form.submit()}
          >
            {t('settings.save')}
          </Button>
        </div>
      </div>
  );
}