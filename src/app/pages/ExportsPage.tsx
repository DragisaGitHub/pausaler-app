import { useMemo, useState } from 'react';
import { Button, DatePicker, Form, Select, Space, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';

import { getStorage } from '../services/storageProvider';

const storage = getStorage();

type ExportType = 'invoices' | 'expenses' | 'both';

type ExportFormValues = {
  exportType: ExportType;
  from: dayjs.Dayjs;
  to: dayjs.Dayjs;
};

function joinPath(dir: string, filename: string): string {
  const hasBackslash = dir.includes('\\');
  const sep = hasBackslash ? '\\' : '/';
  const normalized = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir;
  return `${normalized}${sep}${filename}`;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? path;
}

export function ExportsPage() {
  const { t } = useTranslation();

  const [exporting, setExporting] = useState(false);
  const [form] = Form.useForm<ExportFormValues>();

  const initialValues = useMemo<ExportFormValues>(() => {
    const now = dayjs();
    return {
      exportType: 'both',
      from: now.startOf('month'),
      to: now.endOf('month'),
    };
  }, []);

  const handleExport = async () => {
    const values = await form.validateFields();

    const from = values.from.format('YYYY-MM-DD');
    const to = values.to.format('YYYY-MM-DD');

    if (values.to.isBefore(values.from, 'day')) {
      message.error(t('exports.errors.invalidRange'));
      return;
    }

    const picked = await open({
      directory: true,
      multiple: false,
      title: t('exports.pickFolderTitle'),
    });

    if (!picked) return;
    const folderPath = Array.isArray(picked) ? picked[0] : picked;
    if (!folderPath) return;

    setExporting(true);
    try {
      const savedPaths: string[] = [];

      const invoicesName = `invoices_${from}_${to}.csv`;
      const expensesName = `expenses_${from}_${to}.csv`;

      if (values.exportType === 'invoices' || values.exportType === 'both') {
        const outPath = joinPath(folderPath, invoicesName);
        const p = await storage.exportInvoicesCsv(from, to, outPath);
        savedPaths.push(p);
      }
      if (values.exportType === 'expenses' || values.exportType === 'both') {
        const outPath = joinPath(folderPath, expensesName);
        const p = await storage.exportExpensesCsv(from, to, outPath);
        savedPaths.push(p);
      }

      const names = savedPaths.map(basename);
      message.success(t('exports.success', { files: names.join(', ') }));
    } catch (e) {
      const msg = (e as any)?.message ?? String(e);
      message.error(t('exports.errors.failed', { message: msg }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('exports.title')}
      </Typography.Title>

      <Form<ExportFormValues>
        layout="vertical"
        form={form}
        initialValues={initialValues}
      >
        <Form.Item
          label={t('exports.typeLabel')}
          name="exportType"
          rules={[{ required: true, message: t('exports.typeReq') }]}
        >
          <Select
            options={[
              { value: 'invoices', label: t('exports.types.invoices') },
              { value: 'expenses', label: t('exports.types.expenses') },
              { value: 'both', label: t('exports.types.both') },
            ]}
          />
        </Form.Item>

        <Space size={12} style={{ width: '100%' }}>
          <Form.Item
            label={t('exports.from')}
            name="from"
            rules={[{ required: true, message: t('exports.fromReq') }]}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label={t('exports.to')}
            name="to"
            rules={[{ required: true, message: t('exports.toReq') }]}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        <div style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => void handleExport()} loading={exporting}>
            {t('exports.exportButton')}
          </Button>
        </div>
      </Form>
    </div>
  );
}
