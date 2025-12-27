import { useState } from 'react';
import {
    Button,
    Table,
    Input,
    DatePicker,
    Select,
    Space,
    message,
    Empty,
    Popconfirm,
    Tag,
} from 'antd';
import {
    PlusOutlined,
    EyeOutlined,
    CopyOutlined,
    FilePdfOutlined,
    DeleteOutlined,
    EditOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { Invoice } from '../types';
import { useInvoices } from '../hooks/useInvoices.ts';
import { useClients } from '../hooks/useClients.ts';
import { getStorage } from '../services/storageProvider';
import {
    buildInvoicePdfPayload,
    exportInvoicePdfToDownloads,
    openGeneratedPdf,
} from '../services/invoicePdf';
import { useTranslation } from 'react-i18next';
import { getNumberLocale, normalizeLanguage } from '../i18n';

const storage = getStorage();

const { RangePicker } = DatePicker;

export function InvoicesPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();

    const { invoices, deleteInvoice } = useInvoices();
    const { clients } = useClients();

    const [exportingId, setExportingId] = useState<string | null>(null);

    const [searchText, setSearchText] = useState('');
    const [selectedClient, setSelectedClient] = useState<string | undefined>();
    const [selectedStatus, setSelectedStatus] = useState<Invoice['status'] | undefined>();
    const [dateRange, setDateRange] = useState<
        [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
    >(null);

    const handleDelete = async (id: string) => {
        const ok = await deleteInvoice(id);
        if (ok) {
            message.success(t('invoices.deletedSuccess'));
        } else {
            message.error(t('invoices.notFound'));
        }
    };

    const handleDuplicate = (invoice: Invoice) => {
        const duplicated: Omit<Invoice, 'id' | 'createdAt'> = {
            ...invoice,
            invoiceNumber: '',
            issueDate: dayjs().format('YYYY-MM-DD'),
            serviceDate: dayjs().format('YYYY-MM-DD'),
            status: 'DRAFT',
            dueDate: null,
            paidAt: null,
        };

        navigate('/invoices/new', { state: { duplicate: duplicated } });
    };

    const handleExportPDF = async (invoice: Invoice) => {
        if (exportingId) return;

        if (!invoice.items?.length) {
            message.error(t('invoiceView.missingItems'));
            return;
        }

        const settings = await storage.getSettings();
        if (!settings.isConfigured || !settings.companyName || !settings.pib || !settings.address || !settings.bankAccount) {
            message.error(t('invoiceView.missingCompany'));
            return;
        }

        const client = await storage.getClientById(invoice.clientId);

        const payload = buildInvoicePdfPayload({ invoice, client, settings });

        try {
            setExportingId(invoice.id);
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
            setExportingId(null);
        }
    };

    const clientOptions = clients.map((c) => ({
        label: c.name,
        value: c.id,
    }));

    const filteredInvoices = invoices.filter((invoice) => {
        const matchesSearch =
            !searchText ||
            invoice.invoiceNumber.toLowerCase().includes(searchText.toLowerCase()) ||
            invoice.clientName.toLowerCase().includes(searchText.toLowerCase());

        const matchesClient = !selectedClient || invoice.clientId === selectedClient;

        const matchesStatus = !selectedStatus || (invoice.status ?? 'DRAFT') === selectedStatus;

        const matchesDate =
            !dateRange ||
            !dateRange[0] ||
            !dateRange[1] ||
            (dayjs(invoice.issueDate).isAfter(dateRange[0].startOf('day')) &&
                dayjs(invoice.issueDate).isBefore(dateRange[1].endOf('day')));

        return matchesSearch && matchesClient && matchesStatus && matchesDate;
    });

    const sortedInvoices = [...filteredInvoices].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const columns = [
        {
            title: t('invoices.number'),
            dataIndex: 'invoiceNumber',
            key: 'invoiceNumber',
            width: 150,
            render: (text: string) => <strong>{text}</strong>,
        },
        {
            title: t('invoices.status'),
            dataIndex: 'status',
            key: 'status',
            width: 130,
            render: (status: Invoice['status']) => {
                const color =
                    status === 'PAID'
                        ? 'green'
                        : status === 'SENT'
                            ? 'blue'
                            : status === 'CANCELLED'
                                ? 'red'
                                : 'default';
                return <Tag color={color}>{t(`invoiceStatus.${status}`)}</Tag>;
            },
        },
        {
            title: t('invoices.client'),
            dataIndex: 'clientName',
            key: 'clientName',
        },
        {
            title: t('invoices.issueDate'),
            dataIndex: 'issueDate',
            key: 'issueDate',
            width: 150,
            render: (date: string) => dayjs(date).format('DD.MM.YYYY'),
        },
        {
            title: t('invoices.amount'),
            dataIndex: 'total',
            key: 'total',
            width: 150,
            render: (total: number, record: Invoice) => (
                <strong>
                    {total.toLocaleString(getNumberLocale(normalizeLanguage(i18n.language)), { minimumFractionDigits: 2 })}{' '}
                    {record.currency}
                </strong>
            ),
        },
        {
            title: t('invoices.currency'),
            dataIndex: 'currency',
            key: 'currency',
            width: 100,
        },
        {
            title: t('common.actions'),
            key: 'actions',
            width: 280,
            render: (_: unknown, record: Invoice) => (
                <Space size="small">
                    <Button
                        type="link"
                        icon={<EyeOutlined />}
                        onClick={() => navigate(`/invoices/view/${record.id}`)}
                    >
                        {t('common.view')}
                    </Button>

                    <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => navigate('/invoices/new', { state: { editId: record.id } })}
                    >
                        {t('common.edit')}
                    </Button>

                    <Button
                        type="link"
                        icon={<FilePdfOutlined />}
                        loading={exportingId === record.id}
                        onClick={() => handleExportPDF(record)}
                    >
                        {t('common.pdf')}
                    </Button>

                    <Button
                        type="link"
                        icon={<CopyOutlined />}
                        onClick={() => handleDuplicate(record)}
                    >
                        {t('common.duplicate')}
                    </Button>

                    <Popconfirm
                        title={t('common.delete')}
                        description={t('invoices.deleteConfirm')}
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
                }}
            >
                <h2 style={{ margin: 0 }}>{t('invoices.title')}</h2>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="large"
                    onClick={() => navigate('/invoices/new')}
                >
                    {t('invoices.new')}
                </Button>
            </div>

            <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
                <Space size="middle" wrap>
                    <Input.Search
                        placeholder={t('invoices.searchPlaceholder')}
                        style={{ width: 300 }}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        allowClear
                    />
                    <Select
                        placeholder={t('invoices.filterStatus')}
                        style={{ width: 180 }}
                        value={selectedStatus}
                        onChange={setSelectedStatus}
                        options={['DRAFT', 'SENT', 'PAID', 'CANCELLED'].map((s) => ({
                            label: t(`invoiceStatus.${s}`),
                            value: s,
                        }))}
                        allowClear
                    />
                    <Select
                        placeholder={t('invoices.filterClient')}
                        style={{ width: 250 }}
                        value={selectedClient}
                        onChange={setSelectedClient}
                        options={clientOptions}
                        allowClear
                    />
                    <RangePicker
                        placeholder={[t('invoices.dateFrom'), t('invoices.dateTo')]}
                        format="DD.MM.YYYY"
                        value={dateRange}
                        onChange={setDateRange}
                    />
                </Space>
            </Space>

            <Table
                columns={columns}
                dataSource={sortedInvoices}
                rowKey="id"
                pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    showTotal: (total) => t('invoices.totalCount', { count: total }),
                }}
                locale={{
                    emptyText: (
                        <Empty description={t('invoices.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={() => navigate('/invoices/new')}
                            >
                                {t('invoices.createFirst')}
                            </Button>
                        </Empty>
                    ),
                }}
            />
        </div>
    );
}