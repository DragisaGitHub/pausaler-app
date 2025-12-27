import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Descriptions, Table, Divider, Space, message, Select, DatePicker, Tag } from 'antd';
import { ArrowLeftOutlined, EditOutlined, FilePdfOutlined } from '@ant-design/icons';
import { Client, Invoice, InvoiceItem, Settings } from '../types';
import { getStorage } from '../services/storageProvider';
import dayjs from 'dayjs';
import {
  buildInvoicePdfPayload,
  exportInvoicePdfToDownloads,
  openGeneratedPdf,
} from '../services/invoicePdf';
import { useTranslation } from 'react-i18next';
import { getNumberLocale, normalizeLanguage } from '../i18n';

const storage = getStorage();

export function InvoiceViewPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [client, setClient] = useState<Client | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [exporting, setExporting] = useState(false);
  const [updatingMeta, setUpdatingMeta] = useState(false);

  useEffect(() => {
    if (!id) return;

    void (async () => {
      const data = await storage.getInvoiceById(id);
      if (data) {
        setInvoice(data);
      } else {
        message.error(t('invoices.notFound'));
        navigate('/');
      }
    })();
  }, [id, navigate, t]);

  useEffect(() => {
    void storage.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!invoice) return;
    void storage.getClientById(invoice.clientId).then(setClient);
  }, [invoice]);

  if (!invoice || !settings) return null;

  const numberLocale = getNumberLocale(normalizeLanguage(i18n.language));

  const handleExportPdf = async () => {
    if (exporting) return;

    if (!invoice.items?.length) {
      message.error(t('invoiceView.missingItems'));
      return;
    }

    if (!settings.isConfigured || !settings.companyName || !settings.pib || !settings.address || !settings.bankAccount) {
      message.error(t('invoiceView.missingCompany'));
      return;
    }

    const latestClient = await storage.getClientById(invoice.clientId);

    const payload = buildInvoicePdfPayload({ invoice, client: latestClient, settings });

    try {
      setExporting(true);
      const path = await exportInvoicePdfToDownloads(payload);

      message.success(t('invoiceView.pdfGenerated'));

      try {
        await openGeneratedPdf(path);
      } catch {
        message.info(t('common.path', { path }));
      }
    } catch (e) {
      const msg = typeof e === 'string' ? e : t('invoiceView.pdfError');
      message.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleUpdateInvoice = async (patch: Partial<Invoice>) => {
    if (updatingMeta) return;

    try {
      setUpdatingMeta(true);
      const saved = await storage.updateInvoice(invoice.id, patch);
      if (!saved) {
        message.error(t('invoices.notFound'));
        navigate('/');
        return;
      }
      setInvoice(saved);
    } catch {
      message.error(t('newInvoice.saveError'));
    } finally {
      setUpdatingMeta(false);
    }
  };

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 60,
      render: (_: unknown, __: InvoiceItem, index: number) => index + 1,
    },
    {
      title: t('newInvoice.description'),
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: t('newInvoice.quantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      width: 120,
      align: 'right' as const,
    },
    {
      title: t('newInvoice.unitPrice'),
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 150,
      align: 'right' as const,
      render: (price: number) => price.toLocaleString(numberLocale, { minimumFractionDigits: 2 }),
    },
    {
      title: t('newInvoice.lineTotal'),
      dataIndex: 'total',
      key: 'total',
      width: 150,
      align: 'right' as const,
      render: (total: number) => (
        <strong>{total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}</strong>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          {t('invoiceView.back')}
        </Button>
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => navigate('/invoices/new', { state: { editId: invoice.id } })}
          >
            {t('common.edit')}
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            loading={exporting}
            onClick={handleExportPdf}
          >
            {t('invoiceView.exportPdf')}
          </Button>
        </Space>
      </div>

      <Card>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              {settings.logoUrl && (
                <img
                  src={settings.logoUrl}
                  alt="Company logo"
                  style={{ maxHeight: 80, marginBottom: 16, objectFit: 'contain' }}
                />
              )}
              <h2 style={{ margin: 0 }}>{settings.companyName}</h2>
              <div style={{ color: '#666', marginTop: 8 }}>
                <div>{t('settings.vatId')}: {settings.pib}</div>
                <div>{settings.address}</div>
                <div>{t('settings.bankAccount')}: {settings.bankAccount}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h1 style={{ margin: 0, fontSize: 32, color: '#1890ff' }}>{t('invoiceView.invoice')}</h1>
              <div style={{ fontSize: 18, marginTop: 8 }}>
                <strong>{invoice.invoiceNumber}</strong>
              </div>
            </div>
          </div>
        </div>

        <Divider />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
          <div>
            <h3 style={{ marginBottom: 12 }}>{t('invoiceView.buyer')}:</h3>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('clients.name')}>{invoice.clientName}</Descriptions.Item>
              {client && (
                <>
                  <Descriptions.Item label={t('clients.vatId')}>{client.pib}</Descriptions.Item>
                  <Descriptions.Item label={t('clients.address')}>{client.address}</Descriptions.Item>
                  <Descriptions.Item label={t('clients.email')}>{client.email}</Descriptions.Item>
                </>
              )}
            </Descriptions>
          </div>
          <div>
            <h3 style={{ marginBottom: 12 }}>{t('invoiceView.details')}:</h3>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('newInvoice.issueDate')}>
                {dayjs(invoice.issueDate).format('DD.MM.YYYY')}
              </Descriptions.Item>
              <Descriptions.Item label={t('newInvoice.serviceDate')}>
                {dayjs(invoice.serviceDate).format('DD.MM.YYYY')}
              </Descriptions.Item>
              <Descriptions.Item label={t('invoices.currency')}>{invoice.currency}</Descriptions.Item>
              <Descriptions.Item label={t('invoiceView.status')}>
                <Space size="small">
                  <Tag
                    color={
                      invoice.status === 'PAID'
                        ? 'green'
                        : invoice.status === 'SENT'
                          ? 'blue'
                          : invoice.status === 'CANCELLED'
                            ? 'red'
                            : 'default'
                    }
                  >
                    {t(`invoiceStatus.${invoice.status}`)}
                  </Tag>
                  <Select
                    size="small"
                    style={{ width: 160 }}
                    value={invoice.status}
                    onChange={(value) => void handleUpdateInvoice({ status: value as Invoice['status'] })}
                    disabled={updatingMeta}
                    options={['DRAFT', 'SENT', 'PAID', 'CANCELLED'].map((s) => ({
                      value: s,
                      label: t(`invoiceStatus.${s}`),
                    }))}
                  />
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('invoiceView.dueDate')}>
                <DatePicker
                  allowClear
                  disabled={updatingMeta}
                  format="DD.MM.YYYY"
                  value={invoice.dueDate ? dayjs(invoice.dueDate) : null}
                  onChange={(d) =>
                    void handleUpdateInvoice({ dueDate: d ? d.format('YYYY-MM-DD') : null })
                  }
                />
              </Descriptions.Item>
              {invoice.status === 'PAID' && (
                <Descriptions.Item label={t('invoiceView.paidAt')}>
                  {invoice.paidAt ? dayjs(invoice.paidAt).format('DD.MM.YYYY') : '-'}
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        </div>

        <Divider />

        <h3 style={{ marginBottom: 16 }}>{t('invoiceView.items')}:</h3>
        <Table
          columns={columns}
          dataSource={invoice.items}
          rowKey="id"
          pagination={false}
          bordered
          summary={() => (
            <Table.Summary>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4} align="right">
                  <strong>{t('invoiceView.total')}:</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong style={{ fontSize: 18, color: '#1890ff' }}>
                    {invoice.total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })} {invoice.currency}
                  </strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />

        {invoice.notes && (
          <>
            <Divider />
            <div>
              <h3>{t('invoiceView.notes')}:</h3>
              <p style={{ whiteSpace: 'pre-wrap', color: '#666' }}>{invoice.notes}</p>
            </div>
          </>
        )}

        <Divider />

        <div style={{ color: '#999', fontSize: 12, textAlign: 'center' }}>
          {t('invoiceView.createdAt')}: {dayjs(invoice.createdAt).format('DD.MM.YYYY HH:mm')}
        </div>
      </Card>
    </div>
  );
}