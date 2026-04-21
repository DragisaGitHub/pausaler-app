import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  message,
} from 'antd';
import { MailOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { CURRENCY_VALUES } from '../types';
import type { Offer } from '../types';
import { useOffers } from '../hooks/useOffers';
import { getStorage } from '../services/storageProvider';
import { useLicenseGate } from '../components/LicenseGate';
import { isFeatureAllowed } from '../services/featureGate';
import { useSettings } from '../hooks/useSettings';

const storage = getStorage();

function getOfferSendLabel(t: (key: string) => string, status: Offer['status']) {
  if (status === 'FAILED') return t('offers.retrySend');
  if (status === 'SENT') return t('offers.sendAgain');
  return t('offers.send');
}

type OfferFormValues = {
  clientEmail: string;
  clientName: string;
  subject: string;
  body: string;
  amount: number;
  currency: string;
  validUntil: dayjs.Dayjs;
};

function mapFormValues(values: OfferFormValues): Omit<Offer, 'id' | 'createdAt'> {
  return {
    clientEmail: values.clientEmail.trim(),
    clientName: values.clientName.trim(),
    subject: values.subject.trim(),
    body: values.body.trim(),
    amount: values.amount,
    currency: values.currency,
    validUntil: values.validUntil.format('YYYY-MM-DD'),
    status: 'DRAFT',
    sentAt: null,
    failedReason: null,
  };
}

export function NewOfferPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { status } = useLicenseGate();
  const { settings } = useSettings();
  const { createOffer, updateOffer, sendOfferEmail } = useOffers();

  const canWriteOffers = isFeatureAllowed(status, 'OFFERS_WRITE');
  const canSendOffers = isFeatureAllowed(status, 'OFFERS_SEND_EMAIL');
  const isEditMode = Boolean(id);
  const pageTitle = isEditMode ? t('newOffer.titleEdit') : t('newOffer.titleNew');

  const [form] = Form.useForm<OfferFormValues>();
  const [initialLoading, setInitialLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [persistedOfferId, setPersistedOfferId] = useState<string | null>(id ?? null);
  const [offerStatus, setOfferStatus] = useState<Offer['status']>('DRAFT');
  const [sendFailureCount, setSendFailureCount] = useState(0);

  const defaultCurrency = useMemo(
    () => settings?.defaultCurrency ?? CURRENCY_VALUES[0],
    [settings]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!id) {
        form.setFieldsValue({
          currency: defaultCurrency,
          validUntil: dayjs(),
        });
        setPersistedOfferId(null);
        setOfferStatus('DRAFT');
        setSendFailureCount(0);
        setInitialLoading(false);
        return;
      }

      try {
        const existing = await storage.getOfferById(id);
        if (!existing) {
          message.error(t('newOffer.notFound'));
          navigate('/offers', { replace: true });
          return;
        }

        if (cancelled) return;

        setPersistedOfferId(existing.id);
        setOfferStatus(existing.status);
        setSendFailureCount(0);

        form.setFieldsValue({
          clientEmail: existing.clientEmail,
          clientName: existing.clientName,
          subject: existing.subject,
          body: existing.body,
          amount: existing.amount,
          currency: existing.currency,
          validUntil: dayjs(existing.validUntil),
        });
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [defaultCurrency, form, id, navigate, t]);

  const persistDraft = async (values: OfferFormValues) => {
    const payload = mapFormValues(values);
    const targetId = persistedOfferId ?? id;

    if (targetId) {
      const updated = await updateOffer(targetId, payload);
      if (!updated) {
        throw new Error(t('newOffer.notFound'));
      }
      return updated;
    }

    return createOffer(payload);
  };

  const handleSaveDraft = async () => {
    if (!canWriteOffers) {
      message.error(t('license.lockedDescription'));
      return;
    }

    try {
      setSaving(true);
      const values = await form.validateFields();
      const saved = await persistDraft(values);
      setPersistedOfferId(saved.id);
      setOfferStatus('DRAFT');
      setSendFailureCount(0);
      message.success(t(persistedOfferId ?? id ? 'newOffer.updated' : 'newOffer.created'));
      navigate('/offers');
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) {
        message.error(t('newOffer.validationError'));
      } else {
        const msg = error instanceof Error ? error.message : t('offers.saveError');
        message.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendOffer = async () => {
    if (!canWriteOffers || !canSendOffers) {
      message.error(t('license.lockedDescription'));
      return;
    }

    let didAttemptSend = false;

    try {
      setSending(true);
      const values = await form.validateFields();
      const saved = await persistDraft(values);
      setPersistedOfferId(saved.id);
      setOfferStatus('DRAFT');
      didAttemptSend = true;
      await sendOfferEmail(saved.id);
      setOfferStatus('SENT');
      setSendFailureCount(0);
      message.success(t('newOffer.sent'));
      navigate('/offers');
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) {
        message.error(t('newOffer.validationError'));
      } else {
        if (didAttemptSend) {
          console.error('Failed to send offer', error);
          setOfferStatus('FAILED');
          const nextFailureCount = sendFailureCount + 1;
          setSendFailureCount(nextFailureCount);

          if (nextFailureCount >= 2) {
            Modal.error({
              title: t('offers.sendError'),
              content: t('newOffer.sendFailedRepeated'),
            });
          } else {
            message.error(t('newOffer.sendFailedOnce'));
          }
        } else {
          const msg = error instanceof Error ? error.message : t('offers.saveError');
          message.error(msg);
        }
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0 }}>{pageTitle}</h2>

        <Space>
          <Button onClick={() => navigate('/offers')}>{t('newOffer.close')}</Button>
          <Button
            icon={<SaveOutlined />}
            loading={saving}
            disabled={initialLoading || !canWriteOffers}
            onClick={() => void handleSaveDraft()}
          >
            {t('newOffer.saveDraft')}
          </Button>
          <Button
            type="primary"
            icon={<MailOutlined />}
            loading={sending}
            disabled={initialLoading || !canWriteOffers || !canSendOffers}
            onClick={() => void handleSendOffer()}
          >
            {getOfferSendLabel(t, offerStatus)}
          </Button>
        </Space>
      </div>

      <Card loading={initialLoading}>
        <Form form={form} layout="vertical">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            <Form.Item
              label={t('newOffer.clientName')}
              name="clientName"
              rules={[{ required: true, message: t('newOffer.clientNameReq') }]}
            >
              <Input placeholder={t('newOffer.clientNamePlaceholder')} />
            </Form.Item>

            <Form.Item
              label={t('newOffer.clientEmail')}
              name="clientEmail"
              rules={[
                { required: true, message: t('newOffer.clientEmailReq') },
                { type: 'email', message: t('newOffer.clientEmailInvalid') },
              ]}
            >
              <Input placeholder={t('newOffer.clientEmailPlaceholder')} />
            </Form.Item>

            <Form.Item
              label={t('newOffer.amount')}
              name="amount"
              rules={[{ required: true, message: t('newOffer.amountReq') }]}
            >
              <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              label={t('newOffer.currency')}
              name="currency"
              rules={[{ required: true, message: t('newOffer.currencyReq') }]}
            >
              <Select
                options={CURRENCY_VALUES.map((currency) => ({ label: currency, value: currency }))}
              />
            </Form.Item>

            <Form.Item
              label={t('newOffer.validUntil')}
              name="validUntil"
              rules={[{ required: true, message: t('newOffer.validUntilReq') }]}
            >
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </div>

          <Form.Item
            label={t('newOffer.subject')}
            name="subject"
            rules={[{ required: true, message: t('newOffer.subjectReq') }]}
          >
            <Input placeholder={t('newOffer.subjectPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={t('newOffer.body')}
            name="body"
            rules={[{ required: true, message: t('newOffer.bodyReq') }]}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={8} placeholder={t('newOffer.bodyPlaceholder')} />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}