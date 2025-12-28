import { useEffect, useMemo, useState } from 'react';
import { Card, Col, DatePicker, Row, Space, Statistic, Table, Tabs, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { Expense, Invoice } from '../types';
import { getStorage } from '../services/storageProvider';
import { useSettings } from '../hooks/useSettings';

const storage = getStorage();

type MonthlyStats = {
  issuedTotal: number;
  issuedCount: number;
  paidTotal: number;
  paidCount: number;
  expensesTotal: number;
  expensesCount: number;
  net: number;
};

type YearRow = {
  key: string;
  monthIndex: number; // 0-11
  monthLabel: string;
  issuedTotal: number;
  issuedCount: number;
  paidTotal: number;
  paidCount: number;
  expensesTotal: number;
  expensesCount: number;
  net: number;
};

function normalizeToYmd(value?: string | null): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function inYmdRange(value: string | null, from: string, to: string): boolean {
  if (!value) return false;
  return value >= from && value <= to;
}

function formatMoneyAmount(v: number): string {
  return v.toFixed(2);
}

function emptyMonthlyStats(): MonthlyStats {
  return {
    issuedTotal: 0,
    issuedCount: 0,
    paidTotal: 0,
    paidCount: 0,
    expensesTotal: 0,
    expensesCount: 0,
    net: 0,
  };
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const defaultCurrency = settings?.defaultCurrency ?? 'RSD';

  const [activeTab, setActiveTab] = useState<'monthly' | 'yearly'>('monthly');

  const [selectedMonth, setSelectedMonth] = useState<dayjs.Dayjs>(() => dayjs().startOf('month'));
  const [selectedYear, setSelectedYear] = useState<dayjs.Dayjs>(() => dayjs().startOf('year'));

  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [yearlyLoading, setYearlyLoading] = useState(false);

  const [monthlyInvoices, setMonthlyInvoices] = useState<Invoice[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<Expense[]>([]);

  const [yearlyInvoices, setYearlyInvoices] = useState<Invoice[]>([]);
  const [yearlyExpenses, setYearlyExpenses] = useState<Expense[]>([]);

  const monthRange = useMemo(() => {
    const from = selectedMonth.startOf('month').format('YYYY-MM-DD');
    const to = selectedMonth.endOf('month').format('YYYY-MM-DD');
    return { from, to };
  }, [selectedMonth]);

  const yearRange = useMemo(() => {
    const from = selectedYear.startOf('year').format('YYYY-MM-DD');
    const to = selectedYear.endOf('year').format('YYYY-MM-DD');
    return { from, to };
  }, [selectedYear]);

  useEffect(() => {
    if (activeTab !== 'monthly') return;

    void (async () => {
      setMonthlyLoading(true);
      try {
        const [inv, exp] = await Promise.all([
          storage.listInvoicesRange(monthRange.from, monthRange.to),
          storage.listExpenses({ from: monthRange.from, to: monthRange.to }),
        ]);
        setMonthlyInvoices(inv);
        setMonthlyExpenses(exp);
      } finally {
        setMonthlyLoading(false);
      }
    })();
  }, [activeTab, monthRange.from, monthRange.to]);

  useEffect(() => {
    if (activeTab !== 'yearly') return;

    void (async () => {
      setYearlyLoading(true);
      try {
        const [inv, exp] = await Promise.all([
          storage.listInvoicesRange(yearRange.from, yearRange.to),
          storage.listExpenses({ from: yearRange.from, to: yearRange.to }),
        ]);
        setYearlyInvoices(inv);
        setYearlyExpenses(exp);
      } finally {
        setYearlyLoading(false);
      }
    })();
  }, [activeTab, yearRange.from, yearRange.to]);

  const monthlyStats = useMemo<MonthlyStats>(() => {
    const from = monthRange.from;
    const to = monthRange.to;

    const issued = monthlyInvoices
      .filter((inv) => inv.currency === defaultCurrency)
      .filter((inv) => inv.status === 'SENT' || inv.status === 'PAID')
      .filter((inv) => inYmdRange(normalizeToYmd(inv.issueDate), from, to));

    const paid = monthlyInvoices
      .filter((inv) => inv.currency === defaultCurrency)
      .filter((inv) => inv.status === 'PAID')
      .filter((inv) => inYmdRange(normalizeToYmd(inv.paidAt), from, to));

    const expensesInRange = monthlyExpenses
      .filter((e) => e.currency === defaultCurrency)
      .filter((e) => inYmdRange(normalizeToYmd(e.date), from, to));

    const issuedTotal = issued.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const paidTotal = paid.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const expensesTotal = expensesInRange.reduce((sum, e) => sum + (e.amount || 0), 0);

    return {
      issuedTotal,
      issuedCount: issued.length,
      paidTotal,
      paidCount: paid.length,
      expensesTotal,
      expensesCount: expensesInRange.length,
      net: paidTotal - expensesTotal,
    };
  }, [defaultCurrency, monthRange.from, monthRange.to, monthlyExpenses, monthlyInvoices]);

  const yearRows = useMemo<YearRow[]>(() => {
    const year = selectedYear.year();

    const monthLabels = [
      t('reports.months.jan'),
      t('reports.months.feb'),
      t('reports.months.mar'),
      t('reports.months.apr'),
      t('reports.months.may'),
      t('reports.months.jun'),
      t('reports.months.jul'),
      t('reports.months.aug'),
      t('reports.months.sep'),
      t('reports.months.oct'),
      t('reports.months.nov'),
      t('reports.months.dec'),
    ];

    return Array.from({ length: 12 }, (_, monthIndex) => {
      const from = dayjs().year(year).month(monthIndex).startOf('month').format('YYYY-MM-DD');
      const to = dayjs().year(year).month(monthIndex).endOf('month').format('YYYY-MM-DD');

      const issued = yearlyInvoices
        .filter((inv) => inv.currency === defaultCurrency)
        .filter((inv) => inv.status === 'SENT' || inv.status === 'PAID')
        .filter((inv) => inYmdRange(normalizeToYmd(inv.issueDate), from, to));

      const paid = yearlyInvoices
        .filter((inv) => inv.currency === defaultCurrency)
        .filter((inv) => inv.status === 'PAID')
        .filter((inv) => inYmdRange(normalizeToYmd(inv.paidAt), from, to));

      const expensesInRange = yearlyExpenses
        .filter((e) => e.currency === defaultCurrency)
        .filter((e) => inYmdRange(normalizeToYmd(e.date), from, to));

      const issuedTotal = issued.reduce((sum, inv) => sum + (inv.total || 0), 0);
      const paidTotal = paid.reduce((sum, inv) => sum + (inv.total || 0), 0);
      const expensesTotal = expensesInRange.reduce((sum, e) => sum + (e.amount || 0), 0);

      return {
        key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
        monthIndex,
        monthLabel: monthLabels[monthIndex] ?? String(monthIndex + 1),
        issuedTotal,
        issuedCount: issued.length,
        paidTotal,
        paidCount: paid.length,
        expensesTotal,
        expensesCount: expensesInRange.length,
        net: paidTotal - expensesTotal,
      };
    });
  }, [defaultCurrency, selectedYear, t, yearlyExpenses, yearlyInvoices]);

  const yearTotals = useMemo(() => {
    return yearRows.reduce(
      (acc, r) => {
        acc.issuedTotal += r.issuedTotal;
        acc.issuedCount += r.issuedCount;
        acc.paidTotal += r.paidTotal;
        acc.paidCount += r.paidCount;
        acc.expensesTotal += r.expensesTotal;
        acc.expensesCount += r.expensesCount;
        acc.net += r.net;
        return acc;
      },
      {
        issuedTotal: 0,
        issuedCount: 0,
        paidTotal: 0,
        paidCount: 0,
        expensesTotal: 0,
        expensesCount: 0,
        net: 0,
      }
    );
  }, [yearRows]);

  const yearlyColumns = useMemo<ColumnsType<YearRow>>(
    () => [
      {
        title: t('reports.table.month'),
        dataIndex: 'monthLabel',
        key: 'month',
        width: 120,
      },
      {
        title: t('reports.kpi.issued'),
        key: 'issued',
        render: (_, r) => (
          <div>
            <div>
              {formatMoneyAmount(r.issuedTotal)} {defaultCurrency}
            </div>
            <Typography.Text type="secondary">
              {t('reports.counts.issuedInvoices', { count: r.issuedCount })}
            </Typography.Text>
          </div>
        ),
      },
      {
        title: t('reports.kpi.paid'),
        key: 'paid',
        render: (_, r) => (
          <div>
            <div>
              {formatMoneyAmount(r.paidTotal)} {defaultCurrency}
            </div>
            <Typography.Text type="secondary">
              {t('reports.counts.paidInvoices', { count: r.paidCount })}
            </Typography.Text>
          </div>
        ),
      },
      {
        title: t('reports.kpi.expenses'),
        key: 'expenses',
        render: (_, r) => (
          <div>
            <div>
              {formatMoneyAmount(r.expensesTotal)} {defaultCurrency}
            </div>
            <Typography.Text type="secondary">
              {t('reports.counts.expenses', { count: r.expensesCount })}
            </Typography.Text>
          </div>
        ),
      },
      {
        title: t('reports.kpi.net'),
        dataIndex: 'net',
        key: 'net',
        render: (v: number) => (
          <div>
            {formatMoneyAmount(v)} {defaultCurrency}
          </div>
        ),
      },
    ],
    [defaultCurrency, t]
  );

  const monthlyKpis = useMemo(() => {
    if (monthlyLoading) return null;
    return monthlyStats;
  }, [monthlyLoading, monthlyStats]);

  const renderMonthly = () => {
    const stats = monthlyKpis ?? emptyMonthlyStats();

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <DatePicker
            picker="month"
            value={selectedMonth}
            onChange={(v) => {
              if (v) setSelectedMonth(v.startOf('month'));
            }}
            allowClear={false}
          />
        </Space>

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={monthlyLoading}>
              <Statistic
                title={t('reports.kpi.issued')}
                value={formatMoneyAmount(stats.issuedTotal)}
                suffix={defaultCurrency}
              />
              <Typography.Text type="secondary">
                {t('reports.counts.issuedInvoices', { count: stats.issuedCount })}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={monthlyLoading}>
              <Statistic
                title={t('reports.kpi.paid')}
                value={formatMoneyAmount(stats.paidTotal)}
                suffix={defaultCurrency}
              />
              <Typography.Text type="secondary">
                {t('reports.counts.paidInvoices', { count: stats.paidCount })}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={monthlyLoading}>
              <Statistic
                title={t('reports.kpi.expenses')}
                value={formatMoneyAmount(stats.expensesTotal)}
                suffix={defaultCurrency}
              />
              <Typography.Text type="secondary">
                {t('reports.counts.expenses', { count: stats.expensesCount })}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={monthlyLoading}>
              <Statistic
                title={t('reports.kpi.net')}
                value={formatMoneyAmount(stats.net)}
                suffix={defaultCurrency}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    );
  };

  const renderYearly = () => {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <DatePicker
            picker="year"
            value={selectedYear}
            onChange={(v) => {
              if (v) setSelectedYear(v.startOf('year'));
            }}
            allowClear={false}
          />
        </Space>

        <Card>
          <Table<YearRow>
            dataSource={yearRows}
            columns={yearlyColumns}
            loading={yearlyLoading}
            pagination={false}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <strong>{t('reports.table.total')}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>
                    <div>
                      <strong>
                        {formatMoneyAmount(yearTotals.issuedTotal)} {defaultCurrency}
                      </strong>
                    </div>
                    <Typography.Text type="secondary">
                      {t('reports.counts.issuedInvoices', { count: yearTotals.issuedCount })}
                    </Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2}>
                    <div>
                      <strong>
                        {formatMoneyAmount(yearTotals.paidTotal)} {defaultCurrency}
                      </strong>
                    </div>
                    <Typography.Text type="secondary">
                      {t('reports.counts.paidInvoices', { count: yearTotals.paidCount })}
                    </Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3}>
                    <div>
                      <strong>
                        {formatMoneyAmount(yearTotals.expensesTotal)} {defaultCurrency}
                      </strong>
                    </div>
                    <Typography.Text type="secondary">
                      {t('reports.counts.expenses', { count: yearTotals.expensesCount })}
                    </Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4}>
                    <strong>
                      {formatMoneyAmount(yearTotals.net)} {defaultCurrency}
                    </strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Card>
      </Space>
    );
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space align="center" size={8}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t('reports.title')}
          </Typography.Title>
          <Tooltip title={t('reports.defaultCurrencyNote')}>
            <InfoCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'monthly' | 'yearly')}
        items={[
          {
            key: 'monthly',
            label: t('reports.tabs.monthly'),
            children: renderMonthly(),
          },
          {
            key: 'yearly',
            label: t('reports.tabs.yearly'),
            children: renderYearly(),
          },
        ]}
      />
    </Space>
  );
}
