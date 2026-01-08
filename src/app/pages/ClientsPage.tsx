import { useMemo, useState } from 'react';
import {
  Button,
  Table,
  Space,
  message,
  Modal,
  Form,
  Input,
  Popconfirm,
  Empty,
  Select,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Client } from '../types';
import {useClients} from "../hooks/useClients.ts";
import { useTranslation } from 'react-i18next';
import { useSerbiaCities, type SerbiaCitySelectOption } from '../hooks/useSerbiaCities';
import { useLicenseGate } from '../components/LicenseGate';
import { isFeatureAllowed } from '../services/featureGate';

export function ClientsPage() {
  const { t } = useTranslation();
  const { status } = useLicenseGate();
  const canWriteClients = isFeatureAllowed(status, 'CLIENTS_WRITE');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form] = Form.useForm();

  const serbiaCities = useSerbiaCities();

  const { clients, createClient, updateClient, deleteClient } = useClients();

  // Search / filter / sort state
  const [query, setQuery] = useState('');
  const [cityFilter, setCityFilter] = useState<string | undefined>(undefined);
  const [sorter, setSorter] = useState<{ field?: string; order?: 'ascend' | 'descend' }>({});

  function normalizeSerbianLatin(input: string): string {
    return String(input ?? '')
      .toLowerCase()
      .replace(/[čć]/g, 'c')
      .replace(/š/g, 's')
      .replace(/ž/g, 'z')
      .replace(/đ/g, 'dj');
  }

  const cityFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      const city = String(c.city ?? '').trim();
      if (city) set.add(city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const visibleClients = useMemo(() => {
    const q = normalizeSerbianLatin(query.trim());
    let list = clients;

    if (q) {
      list = list.filter((c) => {
        const fields = [
          c.name,
          c.pib,
          c.email,
          c.address,
          c.city,
          c.postalCode,
          c.registrationNumber,
        ];
        const hay = normalizeSerbianLatin(fields.map((v) => String(v ?? '')).join(' \u0000 '));
        return hay.includes(q);
      });
    }

    if (cityFilter) {
      list = list.filter((c) => String(c.city ?? '') === cityFilter);
    }

    // Sorting
    const withSort = [...list];
    if (sorter.field && sorter.order) {
      const dir = sorter.order === 'ascend' ? 1 : -1;
      const field = sorter.field as keyof Client;
      withSort.sort((a: Client, b: Client) => {
        let av: any = a[field];
        let bv: any = b[field];
        if (field === 'createdAt') {
          const ad = new Date(String(a.createdAt)).getTime();
          const bd = new Date(String(b.createdAt)).getTime();
          return (ad - bd) * dir;
        }
        av = String(av ?? '').toLowerCase();
        bv = String(bv ?? '').toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    } else {
      // Default: newest first
      withSort.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
    }

    return withSort;
  }, [clients, query, cityFilter, sorter]);

  const handleAdd = () => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    setEditingClient(null);
    form.resetFields();
    form.setFieldValue('cityObj', undefined);
    form.setFieldValue('city', '');
    form.setFieldValue('postalCode', '');
    setIsModalVisible(true);
  };

  const handleEdit = (client: Client) => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    setEditingClient(client);
    form.setFieldsValue(client);
    // Prefill Select (value = postalCode) so label shows immediately
    form.setFieldValue('cityObj', client.postalCode);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    const ok = await deleteClient(id);
    if (ok) {
      message.success(t('clients.deleted'));
    } else {
      message.error(t('clients.notFound'));
    }
  };

  const handleSubmit = async (values: Omit<Client, 'id' | 'createdAt'> & { cityObj?: string }) => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    // Ensure we don't persist the helper field `cityObj`
    const { cityObj: _ignore, ...payload } = values as any;
    if (editingClient) {
      const updated = await updateClient(editingClient.id, payload);
      if (updated) {
        message.success(t('clients.updated'));
      } else {
        message.error(t('clients.notFound'));
      }
    } else {
      await createClient(payload as any);
      message.success(t('clients.created'));
    }

    setIsModalVisible(false);
    form.resetFields();
  };

  const sortedClients = visibleClients; // kept name for minimal downstream changes

  const columns = [
    {
      title: t('clients.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
      sorter: true,
      sortOrder: sorter.field === 'name' ? sorter.order : undefined,
    },
    {
      title: t('clients.vatId'),
      dataIndex: 'pib',
      key: 'pib',
      width: 150,
      sorter: true,
      sortOrder: sorter.field === 'pib' ? sorter.order : undefined,
    },
    {
      title: t('clients.address'),
      dataIndex: 'address',
      key: 'address',
      render: (_: unknown, record: Client) => {
        const line1 = record.address?.trim();
        const line2 = [record.postalCode?.trim(), record.city?.trim()]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [line1, line2].filter(Boolean).join(', ');
      },
    },
    {
      title: t('clients.email'),
      dataIndex: 'email',
      key: 'email',
      width: 250,
      sorter: true,
      sortOrder: sorter.field === 'email' ? sorter.order : undefined,
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 150,
      render: (_: unknown, record: Client) => (
          <Space size="small">
            <Button
                type="link"
                icon={<EditOutlined />}
                disabled={!canWriteClients}
                onClick={() => handleEdit(record)}
            >
              {t('common.edit')}
            </Button>
            <Popconfirm
                title={t('clients.deleteTitle')}
                description={t('clients.deleteDesc')}
              disabled={!canWriteClients}
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
          <h2 style={{ margin: 0 }}>{t('clients.title')}</h2>
          <Button
              type="primary"
              icon={<PlusOutlined />}
              size="large"
              disabled={!canWriteClients}
              onClick={handleAdd}
          >
            {t('clients.add')}
          </Button>
        </div>
        {/* Filters toolbar (above table) */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: 12,
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 12,
            background: '#ffffff',
          }}
        >
          <Input.Search
            allowClear
            size="middle"
            placeholder={t('clients.searchPlaceholder')}
            style={{ minWidth: 320, maxWidth: 420, flex: '1 1 320px' }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={(v) => setQuery(v)}
          />
          <Select
            allowClear
            size="middle"
            placeholder={t('clients.cityFilterPlaceholder')}
            style={{ minWidth: 200, width: 220 }}
            value={cityFilter}
            onChange={(v) => setCityFilter(v)}
            options={cityFilterOptions.map((c) => ({ label: c, value: c }))}
          />
          <div style={{ marginLeft: 'auto' }}>
            <Button size="middle" onClick={() => { setQuery(''); setCityFilter(undefined); }}>
              {t('common.reset')}
            </Button>
          </div>
        </div>

        <Table
            columns={columns}
            dataSource={sortedClients}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => t('clients.totalCount', { count: total }),
            }}
            onChange={(_, __, sorterArg) => {
              const s = Array.isArray(sorterArg) ? sorterArg[0] : sorterArg;
              if (s && s.field && s.order) {
                setSorter({ field: String(s.field), order: s.order as any });
              } else {
                setSorter({});
              }
            }}
            locale={{
              emptyText: (
                  <Empty
                      description={t('clients.empty')}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={!canWriteClients}>
                      {t('clients.addFirst')}
                    </Button>
                  </Empty>
              ),
            }}
        />

        <Modal
            title={editingClient ? t('clients.modalEdit') : t('clients.modalAdd')}
            open={isModalVisible}
            onCancel={() => {
              setIsModalVisible(false);
              form.resetFields();
            }}
            footer={null}
            width={600}
        >
          <Form form={form} layout="vertical" onFinish={handleSubmit} size="large" disabled={!canWriteClients}>
            {/* Hidden field to register `city` so it persists */}
            <Form.Item name="city" hidden>
              <Input />
            </Form.Item>
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
              label={t('clients.addressLine1')}
              name="address"
              rules={[{ required: true, message: t('clients.addressLine1Req') }]}
            >
              <Input placeholder={t('clients.addressLine1Placeholder')} />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item
                label={t('clients.city')}
                name="cityObj"
                rules={[{ required: true, message: t('clients.cityReq') }]}
              >
                <Select<string, SerbiaCitySelectOption>
                  showSearch
                  allowClear
                  placeholder={t('clients.cityPlaceholder')}
                  loading={serbiaCities.loading}
                  options={serbiaCities.options}
                  filterOption={false}
                  searchValue={serbiaCities.searchValue}
                  onDropdownVisibleChange={(open) => {
                    if (open) {
                      const currentCity = String(form.getFieldValue('city') ?? '');
                      serbiaCities.initSearchFromText(currentCity);
                    }
                  }}
                  onSearch={serbiaCities.search}
                  onClear={() => {
                      form.setFieldValue('cityObj', undefined);
                    form.setFieldValue('city', '');
                    form.setFieldValue('postalCode', '');
                    serbiaCities.search('');
                  }}
                  onSelect={(_, option) => {
                    const opt = Array.isArray(option) ? (option[0] as SerbiaCitySelectOption) : (option as SerbiaCitySelectOption);
                    form.setFieldValue('city', opt.city);
                    form.setFieldValue('postalCode', opt.postalCode);
                  }}
                />
              </Form.Item>

              <Form.Item
                label={t('clients.postalCode')}
                name="postalCode"
                rules={[
                  { required: true, message: t('clients.postalCodeReq') },
                  () => ({
                    validator(_, value) {
                      const v = String(value ?? '').trim();
                      if (!v) return Promise.resolve();
                      if (!/^[0-9-]+$/.test(v)) {
                        return Promise.reject(new Error(t('clients.postalCodeInvalid')));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input placeholder={t('clients.postalCodePlaceholder')} />
              </Form.Item>
            </div>

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
                <Button
                    onClick={() => {
                      setIsModalVisible(false);
                      form.resetFields();
                    }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="primary" htmlType="submit" disabled={!canWriteClients}>
                  {editingClient ? t('clients.update') : t('clients.add')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
      </div>
  );
}