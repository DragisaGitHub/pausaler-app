import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Radio, Row, Space, Statistic, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useInvoices } from '../hooks/useInvoices';
import { useExpenses } from '../hooks/useExpenses';
import { useSettings } from '../hooks/useSettings';

type Scope = 'month' | 'year';

type Period = {
  startUtcMs: number;
  endUtcMs: number;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseYmdOrIsoToUtcMs(value?: string | null): number | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;

  // Accept both YYYY-MM-DD and full ISO timestamps by taking the first 10 chars.
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

function todayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
}

function currentPeriod(scope: Scope): Period {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const startUtcMs = scope === 'month' ? Date.UTC(year, month, 1) : Date.UTC(year, 0, 1);

  // v1 choice: treat "This Month/This Year" as-to-date (up to today), not the full calendar period.
  const endUtcMs = todayUtcMs();

  return { startUtcMs, endUtcMs };
}

function inPeriod(ms: number | null, period: Period): boolean {
  if (ms === null) return false;
  return ms >= period.startUtcMs && ms <= period.endUtcMs;
}

function formatMoneyAmount(v: number): string {
  return v.toFixed(2);
}

export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const { invoices } = useInvoices();
  const { settings } = useSettings();
  const defaultCurrency = settings?.defaultCurrency ?? 'RSD';

  const { expenses, listExpenses } = useExpenses();
  const [scope, setScope] = useState<Scope>('month');

  const period = useMemo(() => currentPeriod(scope), [scope]);

  useEffect(() => {
    const from = utcMsToYmd(period.startUtcMs);
    const to = utcMsToYmd(period.endUtcMs);
    void listExpenses({ from, to });
  }, [listExpenses, period.endUtcMs, period.startUtcMs]);

  const stats = useMemo(() => {
    const issuedInPeriod = invoices
      .filter((inv) => inv.currency === defaultCurrency)
      .filter((inv) => inPeriod(parseYmdOrIsoToUtcMs(inv.issueDate), period));

    // Paid alignment choice: use paidAt when present; fallback to issueDate.
    const paidInPeriod = invoices.filter((inv) => {
      if (inv.status !== 'PAID') return false;
      if (inv.currency !== defaultCurrency) return false;
      const paidAtMs = parseYmdOrIsoToUtcMs(inv.paidAt);
      const issueMs = parseYmdOrIsoToUtcMs(inv.issueDate);
      return inPeriod(paidAtMs ?? issueMs, period);
    });

    const issuedAmount = issuedInPeriod.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const paidAmount = paidInPeriod.reduce((sum, inv) => sum + (inv.total || 0), 0);

    const overdue = issuedInPeriod.filter((inv) => {
      if (inv.status === 'PAID') return false;
      const dueMs = parseYmdOrIsoToUtcMs(inv.dueDate);
      if (dueMs === null) return false;
      return dueMs < todayUtcMs();
    });

    const overdueAmount = overdue.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const unpaidAmount = issuedAmount - paidAmount;

    const expensesInPeriod = expenses
      .filter((e) => e.currency === defaultCurrency)
      .filter((e) => inPeriod(parseYmdOrIsoToUtcMs(e.date), period));
    const expensesAmount = expensesInPeriod.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netAmount = issuedAmount - expensesAmount;

    return {
      issuedAmount,
      paidAmount,
      unpaidAmount,
      overdueCount: overdue.length,
      overdueAmount,
      expensesAmount,
      netAmount,
      currencySuffix: defaultCurrency,
    };
  }, [defaultCurrency, expenses, invoices, period]);

  const tableData = useMemo(() => {
    if (scope !== 'year') return [];

    const now = new Date();
    const year = now.getUTCFullYear();
    const endMs = todayUtcMs();

    const rows = Array.from({ length: 12 }, (_, idx) => {
      const monthIndex = idx; // 0-11
      const start = Date.UTC(year, monthIndex, 1);
      const next = Date.UTC(year, monthIndex + 1, 1);
      const monthPeriod: Period = {
        startUtcMs: start,
        endUtcMs: Math.min(endMs, next - 1),
      };

      const issued = invoices
        .filter((inv) => inv.currency === defaultCurrency)
        .filter((inv) => inPeriod(parseYmdOrIsoToUtcMs(inv.issueDate), monthPeriod))
        .reduce((sum, inv) => sum + (inv.total || 0), 0);

      const paid = invoices
        .filter((inv) => {
          if (inv.status !== 'PAID') return false;
          if (inv.currency !== defaultCurrency) return false;
          const paidAtMs = parseYmdOrIsoToUtcMs(inv.paidAt);
          const issueMs = parseYmdOrIsoToUtcMs(inv.issueDate);
          return inPeriod(paidAtMs ?? issueMs, monthPeriod);
        })
        .reduce((sum, inv) => sum + (inv.total || 0), 0);

      const monthLabel = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString(i18n.language, {
        month: 'short',
      });

      return {
        key: `${year}-${pad2(monthIndex + 1)}`,
        month: monthLabel,
        issued,
        paid,
      };
    });

    return rows;
  }, [defaultCurrency, i18n.language, invoices, scope]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('overview.title')}
        </Typography.Title>

        <Radio.Group
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { value: 'month', label: t('overview.scopeMonth') },
            { value: 'year', label: t('overview.scopeYear') },
          ]}
        />
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiIssued')}
              value={formatMoneyAmount(stats.issuedAmount)}
              suffix={stats.currencySuffix}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiPaid')}
              value={formatMoneyAmount(stats.paidAmount)}
              suffix={stats.currencySuffix}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiUnpaid')}
              value={formatMoneyAmount(stats.unpaidAmount)}
              suffix={stats.currencySuffix}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiOverdue')}
              value={stats.overdueCount}
              suffix={
                stats.currencySuffix
                  ? `(${formatMoneyAmount(stats.overdueAmount)} ${stats.currencySuffix})`
                  : `(${formatMoneyAmount(stats.overdueAmount)})`
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiExpenses')}
              value={formatMoneyAmount(stats.expensesAmount)}
              suffix={stats.currencySuffix}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={t('overview.kpiNet')}
              value={formatMoneyAmount(stats.netAmount)}
              suffix={stats.currencySuffix}
            />
          </Card>
        </Col>
      </Row>

      {scope === 'year' && (
        <Card title={t('overview.tableTitle')}>
          <Table
            dataSource={tableData}
            pagination={false}
            columns={[
              { title: t('overview.tableMonth'), dataIndex: 'month', key: 'month' },
              {
                title: t('overview.tableIssued'),
                dataIndex: 'issued',
                key: 'issued',
                align: 'right',
                render: (v: number) => (stats.currencySuffix ? `${formatMoneyAmount(v)} ${stats.currencySuffix}` : formatMoneyAmount(v)),
              },
              {
                title: t('overview.tablePaid'),
                dataIndex: 'paid',
                key: 'paid',
                align: 'right',
                render: (v: number) => (stats.currencySuffix ? `${formatMoneyAmount(v)} ${stats.currencySuffix}` : formatMoneyAmount(v)),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
