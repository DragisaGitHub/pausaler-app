import { useState } from 'react';
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
import { useSerbiaCities } from '../hooks/useSerbiaCities';
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

  const handleAdd = () => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    setEditingClient(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEdit = (client: Client) => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    setEditingClient(client);
    form.setFieldsValue(client);
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

  const handleSubmit = async (values: Omit<Client, 'id' | 'createdAt'>) => {
    if (!canWriteClients) {
      message.error(t('license.lockedDescription'));
      return;
    }
    if (editingClient) {
      const updated = await updateClient(editingClient.id, values);
      if (updated) {
        message.success(t('clients.updated'));
      } else {
        message.error(t('clients.notFound'));
      }
    } else {
      await createClient(values);
      message.success(t('clients.created'));
    }

    setIsModalVisible(false);
    form.resetFields();
  };

  const sortedClients = [...clients].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const columns = [
    {
      title: t('clients.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: t('clients.vatId'),
      dataIndex: 'pib',
      key: 'pib',
      width: 150,
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

        <Table
            columns={columns}
            dataSource={sortedClients}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => t('clients.totalCount', { count: total }),
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
                name="city"
                rules={[{ required: true, message: t('clients.cityReq') }]}
              >
                <Select
                  showSearch
                  allowClear
                  placeholder={t('clients.cityPlaceholder')}
                  loading={serbiaCities.loading}
                  options={serbiaCities.options}
                  filterOption={false}
                  onSearch={serbiaCities.search}
                  onClear={() => {
                    form.setFieldValue('postalCode', '');
                  }}
                  onSelect={(_, option) => {
                    const postalCode = String((option as any)?.postalCode ?? '').trim();
                    if (postalCode) {
                      form.setFieldValue('postalCode', postalCode);
                    }
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