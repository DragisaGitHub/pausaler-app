import { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Button, Card, message, Select, Upload } from 'antd';
import { SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { Settings, CURRENCY_VALUES } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from '../i18n';

export function SettingsPage() {
  const { t } = useTranslation();
  const [form] = Form.useForm<Settings>();
  const { settings, loading, save } = useSettings();
  const [logoUrl, setLogoUrl] = useState('');

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue(settings);
    setLogoUrl(settings.logoUrl || '');
  }, [form, settings]);

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
      <div style={{ maxWidth: 800 }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
        </div>

        <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
          <Card title={t('settings.companyCard')} style={{ marginBottom: 24 }}>
            <Form.Item
                label={t('settings.companyName')}
                name="companyName"
                rules={[{ required: true, message: t('settings.companyNameReq') }]}
            >
              <Input placeholder={t('settings.companyNamePlaceholder')} />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item label={t('settings.vatId')} name="pib" rules={[{ required: true, message: t('settings.vatReq') }]}>
                <Input placeholder="123456789" />
              </Form.Item>

              <Form.Item
                  label={t('settings.bankAccount')}
                  name="bankAccount"
                  rules={[{ required: true, message: t('settings.bankReq') }]}
              >
                <Input placeholder="160-5100000000000-00" />
              </Form.Item>
            </div>

            <Form.Item label={t('settings.address')} name="address" rules={[{ required: true, message: t('settings.addressReq') }]}>
              <Input placeholder={t('settings.addressPlaceholder')} />
            </Form.Item>

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
          </Card>

          <Card title={t('settings.invoicesCard')} style={{ marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Form.Item label={t('settings.invoicePrefix')} name="invoicePrefix" rules={[{ required: true, message: t('settings.prefixReq') }]}>
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
          </Card>

          <Card title={t('settings.languageCard')} style={{ marginBottom: 24 }}>
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
          </Card>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} size="large" loading={loading}>
              {t('settings.save')}
            </Button>
          </div>
        </Form>
      </div>
  );
}