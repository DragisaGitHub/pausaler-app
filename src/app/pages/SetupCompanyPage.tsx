import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../types';
import { getStorage } from '../services/storageProvider';

type SetupCompanyPageProps = {
  onCompleted?: () => void;
};

type SetupCompanyForm = Pick<
  Settings,
  'companyName' | 'registrationNumber' | 'pib' | 'companyAddressLine' | 'companyCity' | 'companyPostalCode' | 'bankAccount'
>;

const storage = getStorage();

export function SetupCompanyPage({ onCompleted }: SetupCompanyPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<SetupCompanyForm>();
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');

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

  const handleSubmit = async (values: SetupCompanyForm) => {
    setSaving(true);
    try {
      await storage.updateSettings({
        ...values,
        logoUrl,
        isConfigured: true,
      });

      onCompleted?.();
      message.success(t('settings.saved'));
      navigate('/', { replace: true });
    } catch {
      message.error(t('settings.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('settings.companyCard')}</h2>
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message={t('settings.title')}
        description={
          t('settings.companyCard') +
          ' — ' +
          t('invoiceView.missingCompany')
        }
      />

      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
        <Card title={t('settings.companyCard')}>
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
              <Input placeholder={t('settings.companyCityPlaceholder')} />
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

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" htmlType="submit" size="large" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </Card>
      </Form>
    </div>
  );
}
