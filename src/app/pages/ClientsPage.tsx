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
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Client } from '../types';
import {useClients} from "../hooks/useClients.ts";
import { useTranslation } from 'react-i18next';

export function ClientsPage() {
  const { t } = useTranslation();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form] = Form.useForm();

  const { clients, createClient, updateClient, deleteClient } = useClients();

  const handleAdd = () => {
    setEditingClient(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    form.setFieldsValue(client);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteClient(id);
    if (ok) {
      message.success(t('clients.deleted'));
    } else {
      message.error(t('clients.notFound'));
    }
  };

  const handleSubmit = async (values: Omit<Client, 'id' | 'createdAt'>) => {
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
                onClick={() => handleEdit(record)}
            >
              {t('common.edit')}
            </Button>
            <Popconfirm
                title={t('clients.deleteTitle')}
                description={t('clients.deleteDesc')}
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
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
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
          <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
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
                <Button
                    onClick={() => {
                      setIsModalVisible(false);
                      form.resetFields();
                    }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="primary" htmlType="submit">
                  {editingClient ? t('clients.update') : t('clients.add')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
      </div>
  );
}