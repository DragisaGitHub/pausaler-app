import { useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { Expense, ExpenseRange } from '../types';
import { CURRENCY_VALUES } from '../types';
import { useExpenses } from '../hooks/useExpenses';
import { useSettings } from '../hooks/useSettings';

const { RangePicker } = DatePicker;

type ExpenseFormValues = {
  title: string;
  amount: number;
  currency: string;
  date: dayjs.Dayjs;
  category?: string;
  notes?: string;
};

export function ExpensesPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const defaultCurrency = settings?.defaultCurrency ?? 'RSD';

  const { expenses, listExpenses, createExpense, updateExpense, deleteExpense } = useExpenses();

  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form] = Form.useForm<ExpenseFormValues>();

  const applyFilters = async (nextRange: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => {
    const from = nextRange?.[0]?.format('YYYY-MM-DD');
    const to = nextRange?.[1]?.format('YYYY-MM-DD');
    const range: ExpenseRange | undefined = from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined;
    await listExpenses(range);
  };

  const handleAdd = () => {
    setEditingExpense(null);
    form.resetFields();
    form.setFieldsValue({
      currency: defaultCurrency,
      date: dayjs(),
    } as any);
    setIsModalVisible(true);
  };

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
    form.setFieldsValue({
      title: expense.title,
      amount: expense.amount,
      currency: expense.currency,
      date: dayjs(expense.date),
      category: expense.category ?? '',
      notes: expense.notes ?? '',
    });
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteExpense(id);
    if (ok) {
      message.success(t('expenses.deleted'));
    } else {
      message.error(t('expenses.notFound'));
    }
  };

  const handleSubmit = async (values: ExpenseFormValues) => {
    const title = values.title.trim();
    const categoryTrimmed = (values.category ?? '').trim();
    const notesTrimmed = (values.notes ?? '').trim();

    if (editingExpense) {
      const patch: Partial<Omit<Expense, 'id' | 'createdAt'>> = {
        title,
        amount: values.amount,
        currency: values.currency,
        date: values.date.format('YYYY-MM-DD'),
        category: categoryTrimmed ? categoryTrimmed : null,
        notes: notesTrimmed ? notesTrimmed : null,
      };

      const updated = await updateExpense(editingExpense.id, patch);
      if (updated) {
        message.success(t('expenses.updated'));
      } else {
        message.error(t('expenses.notFound'));
      }
    } else {
      const input: Omit<Expense, 'id' | 'createdAt'> = {
        title,
        amount: values.amount,
        currency: values.currency,
        date: values.date.format('YYYY-MM-DD'),
        category: categoryTrimmed ? categoryTrimmed : undefined,
        notes: notesTrimmed ? notesTrimmed : undefined,
      };

      await createExpense(input);
      message.success(t('expenses.created'));
    }

    setIsModalVisible(false);
    form.resetFields();
  };

  const filteredExpenses = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = [...expenses];

    if (!q) return list;

    return list.filter((e) => {
      const haystack = [e.title, e.category ?? '', e.notes ?? ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [expenses, searchText]);

  const sortedExpenses = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      const aKey = `${a.date} ${a.createdAt}`;
      const bKey = `${b.date} ${b.createdAt}`;
      return bKey.localeCompare(aKey);
    });
  }, [filteredExpenses]);

  const columns = [
    {
      title: t('expenses.date'),
      dataIndex: 'date',
      key: 'date',
      width: 140,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: t('expenses.titleCol'),
      dataIndex: 'title',
      key: 'title',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: t('expenses.category'),
      dataIndex: 'category',
      key: 'category',
      width: 180,
      render: (v: string | null | undefined) => v ?? '',
    },
    {
      title: t('expenses.amount'),
      dataIndex: 'amount',
      key: 'amount',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, record: Expense) => `${record.amount.toFixed(2)} ${record.currency}`,
    },
    {
      title: t('expenses.notes'),
      dataIndex: 'notes',
      key: 'notes',
      render: (v: string | null | undefined) => v ?? '',
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Expense) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('expenses.deleteTitle')}
            description={t('expenses.deleteDesc')}
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
        <h2 style={{ margin: 0 }}>{t('expenses.title')}</h2>

        <Space wrap>
          <Input
            placeholder={t('expenses.searchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ width: 260 }}
          />
          <RangePicker
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              void applyFilters(next);
            }}
            format="DD.MM.YYYY"
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={handleAdd}>
            {t('expenses.add')}
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={sortedExpenses}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => t('expenses.totalCount', { count: total }),
        }}
        locale={{
          emptyText: (
            <Empty description={t('expenses.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                {t('expenses.addFirst')}
              </Button>
            </Empty>
          ),
        }}
      />

      <Modal
        title={editingExpense ? t('expenses.modalEdit') : t('expenses.modalAdd')}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
          <Form.Item label={t('expenses.titleCol')} name="title" rules={[{ required: true, message: t('expenses.titleReq') }]}>
            <Input placeholder={t('expenses.titlePlaceholder')} />
          </Form.Item>

          <Space style={{ width: '100%' }} size={12} align="start">
            <Form.Item
              label={t('expenses.amount')}
              name="amount"
              style={{ flex: 1 }}
              rules={[{ required: true, message: t('expenses.amountReq') }]}
            >
              <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              label={t('expenses.currency')}
              name="currency"
              style={{ width: 160 }}
              rules={[{ required: true, message: t('expenses.currencyReq') }]}
            >
              <Select
                options={CURRENCY_VALUES.map((c) => ({ value: c, label: t(`currencies.${c}`) }))}
              />
            </Form.Item>

            <Form.Item
              label={t('expenses.date')}
              name="date"
              style={{ width: 200 }}
              rules={[{ required: true, message: t('expenses.dateReq') }]}
            >
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>

          <Form.Item label={t('expenses.category')} name="category">
            <Input placeholder={t('expenses.categoryPlaceholder')} />
          </Form.Item>

          <Form.Item label={t('expenses.notes')} name="notes">
            <Input.TextArea rows={3} placeholder={t('expenses.notesPlaceholder')} />
          </Form.Item>

          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  setIsModalVisible(false);
                  form.resetFields();
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="primary" htmlType="submit">
                {editingExpense ? t('expenses.update') : t('expenses.add')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
