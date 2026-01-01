import { useEffect, useState } from 'react';
import { Button, Modal, Space, Typography, message, Input } from 'antd';
import { CopyOutlined, KeyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { generateActivationCode } from '../services/licenseService';

type TrialExpiredModalProps = {
  open: boolean;
  onOpenLicense: () => void;
};

export function TrialExpiredModal({ open, onOpenLicense }: TrialExpiredModalProps) {
  const { t } = useTranslation();
  const [activationCode, setActivationCode] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActivationCode('');
  }, [open]);

  const doGenerate = async () => {
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

  return (
    <Modal
      open={open}
      title={t('license.lockedTitle')}
      closable={false}
      maskClosable={false}
      footer={
        <Space>
          <Button icon={<KeyOutlined />} onClick={onOpenLicense} type="primary">
            {t('license.openLicense')}
          </Button>
          <Button onClick={() => void doGenerate()} loading={generating}>
            {t('license.generateActivationCode')}
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => void doCopy()} disabled={!activationCode}>
            {t('license.copy')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        {t('license.lockedDescription')}
      </Typography.Paragraph>

      <Input.TextArea
        value={activationCode}
        readOnly
        autoSize={{ minRows: 3, maxRows: 6 }}
        placeholder={t('license.activationCodePlaceholder')}
      />
    </Modal>
  );
}
