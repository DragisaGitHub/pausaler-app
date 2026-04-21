import { useMemo, useState } from 'react';

import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  MailOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { Offer } from '../types';
import { useOffers } from '../hooks/useOffers';
import { useLicenseGate } from '../components/LicenseGate';
import { isFeatureAllowed } from '../services/featureGate';
import { getNumberLocale, normalizeLanguage } from '../i18n';

function renderOfferStatusTag(t: (key: string) => string, status: Offer['status']) {
  const color = status === 'SENT' ? 'green' : status === 'FAILED' ? 'red' : 'gold';
  return <Tag color={color}>{t(`offerStatus.${status}`)}</Tag>;
}

function getOfferSendLabel(t: (key: string) => string, status: Offer['status']) {
  if (status === 'FAILED') return t('offers.retrySend');
  if (status === 'SENT') return t('offers.sendAgain');
  return t('offers.send');
}

export function OffersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status } = useLicenseGate();

  const canWriteOffers = isFeatureAllowed(status, 'OFFERS_WRITE');
  const canSendOffers = isFeatureAllowed(status, 'OFFERS_SEND_EMAIL');
  const { offers, loading, deleteOffer, sendOfferEmail } = useOffers();

  const [searchText, setSearchText] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const filteredOffers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const list = [...offers].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (!query) return list;

    return list.filter((offer) =>
      [offer.clientName, offer.clientEmail, offer.subject]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [offers, searchText]);

  const handleDelete = async (id: string) => {
    if (!canWriteOffers) {
      message.error(t('license.lockedDescription'));
      return;
    }

    const ok = await deleteOffer(id);
    if (ok) {
      message.success(t('offers.deletedSuccess'));
    } else {
      message.error(t('offers.notFound'));
    }
  };

  const handleSend = async (offerId: string) => {
    if (!canSendOffers) {
      message.error(t('license.lockedDescription'));
      return;
    }

    try {
      setSendingId(offerId);
      await sendOfferEmail(offerId);
      message.success(t('offers.sendSuccess'));
    } catch (error) {
      const msg = typeof error === 'string' ? error : t('offers.sendError');
      message.error(msg);
    } finally {
      setSendingId(null);
    }
  };

  const columns = [
    {
      title: t('offers.clientName'),
      dataIndex: 'clientName',
      key: 'clientName',
      render: (value: string) => <strong>{value}</strong>,
    },
    {
      title: t('offers.clientEmail'),
      dataIndex: 'clientEmail',
      key: 'clientEmail',
      width: 240,
    },
    {
      title: t('offers.subject'),
      dataIndex: 'subject',
      key: 'subject',
    },
    {
      title: t('offers.amount'),
      key: 'amount',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, record: Offer) => (
        <strong>
          {record.amount.toLocaleString(getNumberLocale(normalizeLanguage(i18n.language)), {
            minimumFractionDigits: 2,
          })}{' '}
          {record.currency}
        </strong>
      ),
    },
    {
      title: t('offers.validUntil'),
      dataIndex: 'validUntil',
      key: 'validUntil',
      width: 150,
      render: (value: string) => dayjs(value).format('DD.MM.YYYY'),
    },
    {
      title: t('invoices.status'),
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (value: Offer['status']) => renderOfferStatusTag(t, value),
    },
    {
      title: t('offers.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value: string) => dayjs(value).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 220,
      render: (_: unknown, record: Offer) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EditOutlined />}
            disabled={!canWriteOffers}
            onClick={() => navigate(`/offers/edit/${record.id}`)}
          >
            {t('common.edit')}
          </Button>

          <Button
            type="link"
            icon={<MailOutlined />}
            disabled={!canSendOffers}
            loading={sendingId === record.id}
            onClick={() => void handleSend(record.id)}
          >
            {getOfferSendLabel(t, record.status)}
          </Button>

          <Popconfirm
            title={t('common.delete')}
            description={t('offers.deleteConfirm')}
            disabled={!canWriteOffers}
            onConfirm={() => void handleDelete(record.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
        <h2 style={{ margin: 0 }}>{t('offers.title')}</h2>

        <Space wrap>
          <Input
            placeholder={t('offers.searchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            disabled={!canWriteOffers}
            onClick={() => navigate('/offers/new')}
          >
            {t('offers.new')}
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filteredOffers}
        pagination={{ pageSize: 10 }}
        locale={{
          emptyText: (
            <Empty description={t('offers.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
              {canWriteOffers ? (
                <Button type="primary" onClick={() => navigate('/offers/new')}>
                  {t('offers.createFirst')}
                </Button>
              ) : null}
            </Empty>
          ),
        }}
      />
    </div>
  );
}