import { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Table,
  Space,
  Card,
  message,
  InputNumber,
  Divider,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';

import {
  Client,
  CURRENCY_VALUES,
  Invoice,
  INVOICE_UNIT_VALUES,
  InvoiceItem,
  InvoiceUnit,
  invoiceUnitLabel,
  normalizeInvoiceUnit,
} from '../types';
import { getStorage } from '../services/storageProvider';
import { useTranslation } from 'react-i18next';
import { getNumberLocale, normalizeLanguage } from '../i18n';

const storage = getStorage();

type LocationState =
  | { duplicate?: Invoice; duplicateId?: string }
  | { edit?: Invoice; editId?: string }
  | undefined;

export function NewInvoicePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;

  const numberLocale = getNumberLocale(normalizeLanguage(i18n.language));

  const [form] = Form.useForm();
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isClientModalVisible, setIsClientModalVisible] = useState(false);
  const [clientForm] = Form.useForm();
  const [invoiceNumberPreview, setInvoiceNumberPreview] = useState<string | null>(null);

  const editId = useMemo(() => {
    if (!state) return undefined;
    if ('editId' in state && state.editId) return state.editId;
    if ('edit' in state && state.edit?.id) return state.edit.id;
    return undefined;
  }, [state]);

  const duplicateId = useMemo(() => {
    if (!state) return undefined;
    if ('duplicateId' in state && state.duplicateId) return state.duplicateId;
    if ('duplicate' in state && state.duplicate?.id) return state.duplicate.id;
    return undefined;
  }, [state]);

  const isEditMode = !!editId;

  useEffect(() => {
    if (isEditMode) return;

    let cancelled = false;

    const load = async () => {
      try {
        const preview = await storage.previewNextInvoiceNumber();
        if (cancelled) return;
        setInvoiceNumberPreview(preview);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to preview next invoice number', e);
        setInvoiceNumberPreview(null);
      }
    };

    void load();

    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [isEditMode]);

  const normalizeItems = (rawItems: InvoiceItem[]): InvoiceItem[] =>
    rawItems.map((it) => {
      const unit = normalizeInvoiceUnit((it as any).unit);
      const discountAmount = it.discountAmount == null ? undefined : Number(it.discountAmount);
      const quantity = Number(it.quantity || 0);
      const unitPrice = Number(it.unitPrice || 0);
      const lineSubtotal = quantity * unitPrice;
      const lineDiscount = Math.min(Math.max(Number(discountAmount || 0), 0), lineSubtotal);
      return {
        ...it,
        unit,
        discountAmount,
        total: lineSubtotal - lineDiscount,
      };
    });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loadedClients = await storage.getAllClients();
      if (!cancelled) setClients(loadedClients);

      if (editId) {
        const existing = await storage.getInvoiceById(editId);
        if (!existing) {
          message.error(t('newInvoice.notFound'));
          navigate('/');
          return;
        }

        form.setFieldsValue({
          clientId: existing.clientId,
          issueDate: dayjs(existing.issueDate),
          serviceDate: dayjs(existing.serviceDate),
          currency: existing.currency,
          notes: existing.notes,
        });
        if (!cancelled) setItems(normalizeItems(existing.items));
        return;
      }

      if (duplicateId) {
        const existing = await storage.getInvoiceById(duplicateId);
        if (!existing) {
          message.error(t('newInvoice.notFound'));
          navigate('/');
          return;
        }

        form.setFieldsValue({
          clientId: existing.clientId,
          issueDate: dayjs(),
          serviceDate: dayjs(),
          currency: existing.currency,
          notes: existing.notes,
        });
        if (!cancelled) setItems(normalizeItems(existing.items));
        return;
      }

      if (state && 'duplicate' in state && state.duplicate) {
        const d = state.duplicate;
        form.setFieldsValue({
          clientId: d.clientId,
          issueDate: dayjs(),
          serviceDate: dayjs(),
          currency: d.currency,
          notes: d.notes,
        });
        if (!cancelled) setItems(normalizeItems(d.items));
        return;
      }

      const settings = await storage.getSettings();
      form.setFieldsValue({
        issueDate: dayjs(),
        serviceDate: dayjs(),
        currency: settings.defaultCurrency,
      });
      if (!cancelled) setItems([]);
    })();

    return () => {
      cancelled = true;
    };
  }, [editId, duplicateId, state, form, navigate]);

  const handleAddItem = () => {
    const newItem: InvoiceItem = {
      id: Date.now().toString(),
      description: '',
      unit: 'kom',
      quantity: 1,
      unitPrice: 0,
      discountAmount: undefined,
      total: 0,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleItemChange = (
    id: string,
    field: keyof InvoiceItem,
    value: string | number | null
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated: InvoiceItem = { ...item, [field]: value as any } as InvoiceItem;

        if (field === 'discountAmount' && value == null) {
          updated.discountAmount = undefined;
        }

        if (field === 'quantity' || field === 'unitPrice' || field === 'discountAmount') {
          const lineSubtotal = Number(updated.quantity || 0) * Number(updated.unitPrice || 0);
          const rawDiscount = Number(updated.discountAmount || 0);
          const lineDiscount = Math.min(Math.max(rawDiscount, 0), lineSubtotal);
          updated.total = lineSubtotal - lineDiscount;
        }
        return updated;
      })
    );
  };

  const calculateTotals = () => {
    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
      0
    );
    const discountTotal = items.reduce((sum, item) => {
      const lineSubtotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
      const rawDiscount = Number(item.discountAmount || 0);
      const lineDiscount = Math.min(Math.max(rawDiscount, 0), lineSubtotal);
      return sum + lineDiscount;
    }, 0);
    const total = subtotal - discountTotal;
    return { subtotal, total };
  };

  const handleAddClient = async (values: Omit<Client, 'id' | 'createdAt'>) => {
    const newClient = await storage.createClient(values);
    setClients((prev) => [...prev, newClient]);
    form.setFieldValue('clientId', newClient.id);
    setIsClientModalVisible(false);
    clientForm.resetFields();
    message.success(t('clients.created'));
  };

  const handleSave = async (exportPDF = false) => {
    try {
      const values = await form.validateFields();

      if (items.length === 0) {
        message.error(t('newInvoice.needItem'));
        return;
      }

      const hasInvalidItems = items.some(
        (item) => !item.description || item.quantity <= 0 || item.unitPrice <= 0
      );
      if (hasInvalidItems) {
        message.error(t('newInvoice.invalidItems'));
        return;
      }

      const client = clients.find((c) => c.id === values.clientId);
      if (!client) {
        message.error(t('newInvoice.clientNotFound'));
        return;
      }

      const totals = calculateTotals();

      if (editId) {
        const updated: Partial<Invoice> = {
          clientId: values.clientId,
          clientName: client.name,
          issueDate: values.issueDate.format('YYYY-MM-DD'),
          serviceDate: values.serviceDate.format('YYYY-MM-DD'),
          currency: values.currency,
          items,
          subtotal: totals.subtotal,
          total: totals.total,
          notes: values.notes || '',
        };

        const saved = await storage.updateInvoice(editId, updated);
        if (!saved) {
          message.error(t('newInvoice.notFound'));
          navigate('/');
          return;
        }

        message.success(t('newInvoice.updated'));

        if (exportPDF) {
          message.info(t('newInvoice.exportInDev'));
        }

        navigate(`/invoices/view/${editId}`);
        return;
      }

      const invoice: Omit<Invoice, 'id' | 'createdAt'> = {
        // Invoice number is generated atomically on the Rust side.
        invoiceNumber: '',
        clientId: values.clientId,
        clientName: client.name,
        issueDate: values.issueDate.format('YYYY-MM-DD'),
        serviceDate: values.serviceDate.format('YYYY-MM-DD'),
        status: 'DRAFT',
        dueDate: null,
        paidAt: null,
        currency: values.currency,
        items,
        subtotal: totals.subtotal,
        total: totals.total,
        notes: values.notes || '',
      };
      const created = await storage.createInvoice(invoice);
      message.success(t('newInvoice.created'));

      if (exportPDF) {
        message.info(t('newInvoice.exportInDev'));
      }

      navigate(`/invoices/view/${created.id}`);
    } catch (error) {
      const anyError = error as any;
      if (anyError?.errorFields) {
        // Form validation errors are also shown inline by antd.
        message.error(t('newInvoice.validationError'));
        return;
      }
      message.error(t('newInvoice.saveError'));
    }
  };

  const totals = calculateTotals();

  const itemColumns = [
    {
      title: t('newInvoice.description'),
      dataIndex: 'description',
      key: 'description',
      width: '34%',
      render: (_: string, record: InvoiceItem) => (
        <Input
          placeholder={t('newInvoice.descriptionPlaceholder')}
          value={record.description}
          onChange={(e) =>
            handleItemChange(record.id, 'description', e.target.value)
          }
        />
      ),
    },
    {
      title: t('newInvoice.unit'),
      dataIndex: 'unit',
      key: 'unit',
      width: '12%',
      render: (_: string, record: InvoiceItem) => (
        <Select<InvoiceUnit>
          value={record.unit}
          onChange={(value) => handleItemChange(record.id, 'unit', value)}
          options={INVOICE_UNIT_VALUES.map((u) => ({ value: u, label: invoiceUnitLabel(u) }))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: t('newInvoice.quantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      width: '15%',
      render: (_: number, record: InvoiceItem) => (
        <InputNumber
          min={0.01}
          step={0.01}
          value={record.quantity}
          onChange={(value) =>
            handleItemChange(record.id, 'quantity', value || 0)
          }
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: t('newInvoice.unitPrice'),
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: '14%',
      render: (_: number, record: InvoiceItem) => (
        <InputNumber
          min={0}
          step={0.01}
          value={record.unitPrice}
          onChange={(value) =>
            handleItemChange(record.id, 'unitPrice', value || 0)
          }
          style={{ width: '100%' }}
          formatter={(value) =>
            `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
          }
        />
      ),
    },
    {
      title: t('newInvoice.discountAmount'),
      dataIndex: 'discountAmount',
      key: 'discountAmount',
      width: '15%',
      render: (_: number, record: InvoiceItem) => (
        <InputNumber
          min={0}
          step={0.01}
          value={record.discountAmount}
          onChange={(value) =>
            handleItemChange(record.id, 'discountAmount', value)
          }
          style={{ width: '100%' }}
          formatter={(value) =>
            `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
          }
        />
      ),
    },
    {
      title: t('newInvoice.lineTotal'),
      dataIndex: 'total',
      key: 'total',
      width: '15%',
      render: (total: number) => (
        <strong>
          {total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
        </strong>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '5%',
      render: (_: unknown, record: InvoiceItem) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveItem(record.id)}
        />
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
        }}
      >
        <h2 style={{ margin: 0 }}>
          {isEditMode ? t('newInvoice.titleEdit') : t('newInvoice.titleNew')}
        </h2>
        <Space>
          <Button
            onClick={() =>
              isEditMode && editId
                ? navigate(`/invoices/view/${editId}`)
                : navigate('/')
            }
          >
            {t('common.cancel')}
          </Button>
          <Button icon={<SaveOutlined />} onClick={() => void handleSave(false)}>
            {t('common.save')}
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={() => void handleSave(true)}
          >
            {t('newInvoice.saveAndExport')}
          </Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" size="large">
        <Card title={t('newInvoice.basicInfo')} style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isEditMode ? '1fr 1fr' : '1fr 1fr 1fr',
              gap: 16,
            }}
          >
            <Form.Item
              label={t('newInvoice.selectClient')}
              name="clientId"
              rules={[{ required: true, message: t('newInvoice.selectClient') }]}
            >
              <Select
                placeholder={t('newInvoice.selectClient')}
                showSearch
                optionFilterProp="label"
                options={clients.map((c) => ({ label: c.name, value: c.id }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => setIsClientModalVisible(true)}
                      style={{ width: '100%' }}
                    >
                      {t('newInvoice.addNewClient')}
                    </Button>
                  </>
                )}
              />
            </Form.Item>

            <Form.Item
              label={t('newInvoice.selectCurrency')}
              name="currency"
              rules={[{ required: true, message: t('newInvoice.selectCurrency') }]}
            >
              <Select
                placeholder={t('newInvoice.selectCurrency')}
                options={CURRENCY_VALUES.map((c) => ({ value: c, label: t(`currencies.${c}`) }))}
              />
            </Form.Item>

            {!isEditMode && (
              <Form.Item
                label={t('newInvoice.invoiceNumberPreviewLabel')}
                help={t('newInvoice.invoiceNumberPreviewHelp')}
              >
                <Input
                  disabled
                  value={invoiceNumberPreview ?? ''}
                  placeholder={t('common.loading')}
                />
              </Form.Item>
            )}

            <Form.Item
              label={t('newInvoice.issueDate')}
              name="issueDate"
              rules={[{ required: true, message: t('newInvoice.issueDate') }]}
            >
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>

            <Form.Item
              label={t('newInvoice.serviceDate')}
              name="serviceDate"
              rules={[{ required: true, message: t('newInvoice.serviceDate') }]}
            >
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </div>
        </Card>

        <Card
          title={t('newInvoice.invoiceItems')}
          extra={
            <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddItem}>
              {t('newInvoice.addItem')}
            </Button>
          }
          style={{ marginBottom: 24 }}
        >
          <Table
            columns={itemColumns}
            dataSource={items}
            rowKey="id"
            pagination={false}
            locale={{ emptyText: t('newInvoice.emptyItems') }}
          />
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24 }}>
          <Card title={t('newInvoice.notes')}>
            <Form.Item name="notes" style={{ marginBottom: 0 }}>
              <Input.TextArea rows={6} placeholder={t('newInvoice.notesPlaceholder')} />
            </Form.Item>
          </Card>

          <Card title={t('newInvoice.summary')}>
            <div style={{ fontSize: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span>{t('newInvoice.subtotal')}:</span>
                <strong>
                  {totals.subtotal.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                </strong>
              </div>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
                <strong>{t('newInvoice.total')}:</strong>
                <strong style={{ color: '#1890ff' }}>
                  {totals.total.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}{' '}
                  {form.getFieldValue('currency') || 'RSD'}
                </strong>
              </div>
            </div>
          </Card>
        </div>
      </Form>

      <Modal
        title={t('newInvoice.clientModalTitle')}
        open={isClientModalVisible}
        onCancel={() => {
          setIsClientModalVisible(false);
          clientForm.resetFields();
        }}
        footer={null}
      >
        <Form form={clientForm} layout="vertical" onFinish={handleAddClient}>
          <Form.Item
            label={t('clients.name')}
            name="name"
            rules={[{ required: true, message: t('clients.nameReq') }]}
          >
            <Input placeholder={t('clients.companyNamePlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('clients.vatId')}
            name="pib"
            rules={[{ required: true, message: t('clients.vatReq') }]}
          >
            <Input placeholder="123456789" />
          </Form.Item>

          <Form.Item
            label={t('clients.companyRegNumber')}
            name="registrationNumber"
            rules={[{ required: true, message: t('clients.companyRegNumberReq') }]}
          >
            <Input placeholder="12345678" />
          </Form.Item>
          <Form.Item
            label={t('clients.address')}
            name="address"
            rules={[{ required: true, message: t('clients.addressReq') }]}
          >
            <Input placeholder="Ulica i broj, grad" />
          </Form.Item>
          <Form.Item
            label={t('clients.email')}
            name="email"
            rules={[
              { required: true, message: t('clients.emailReq') },
              { type: 'email', message: t('clients.emailInvalid') },
            ]}
          >
            <Input placeholder="kontakt@firma.rs" />
          </Form.Item>
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setIsClientModalVisible(false)}>{t('common.cancel')}</Button>
              <Button type="primary" htmlType="submit">
                {t('clients.add')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}