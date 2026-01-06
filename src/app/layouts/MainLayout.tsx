import { useState } from 'react';
import { Layout, Menu, theme } from 'antd';
import { FileTextOutlined, UserOutlined, SettingOutlined, FlagOutlined, DashboardOutlined, BarChartOutlined, DollarOutlined, ExportOutlined, FileSearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TitleBar } from '../components/TitleBar';
import { LicenseGate } from '../components/LicenseGate';
import { useUpdateBadge } from '../hooks/useUpdateBadge';

const { Sider, Content } = Layout;

export function MainLayout({ needsSetup = false }: { needsSetup?: boolean }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const updateBadge = useUpdateBadge();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  const selectedKey = location.pathname.startsWith('/invoices/') ? '/' : location.pathname;

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.invoices')}</span> : <Link to="/">{t('nav.invoices')}</Link>,
    },
    {
      key: '/overview',
      icon: <BarChartOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.overview')}</span> : <Link to="/overview">{t('nav.overview')}</Link>,
    },
    {
      key: '/expenses',
      icon: <DollarOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.expenses')}</span> : <Link to="/expenses">{t('nav.expenses')}</Link>,
    },
    {
      key: '/reports',
      icon: <FileSearchOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.reports')}</span> : <Link to="/reports">{t('nav.reports')}</Link>,
    },
    {
      key: '/exports',
      icon: <ExportOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.exports')}</span> : <Link to="/exports">{t('nav.exports')}</Link>,
    },
    {
      key: '/clients',
      icon: <UserOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.clients')}</span> : <Link to="/clients">{t('nav.clients')}</Link>,
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      disabled: needsSetup,
      label: needsSetup ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {t('nav.settings')}
          {updateBadge.available ? <FlagOutlined style={{ color: '#ff4d4f' }} aria-label="Dostupno ažuriranje" /> : null}
        </span>
      ) : (
        <Link to="/settings">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {t('nav.settings')}
            {updateBadge.available ? <FlagOutlined style={{ color: '#ff4d4f' }} aria-label="Dostupno ažuriranje" /> : null}
          </span>
        </Link>
      ),
    },
    {
      key: '/license',
      icon: <SafetyCertificateOutlined />,
      disabled: false,
      label: <Link to="/license">{t('nav.license')}</Link>,
    },
  ];

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ['--app-sider-width' as any]: collapsed ? '80px' : '240px',
      }}
    >
      <TitleBar />

      <Layout style={{ flex: 1, minHeight: 0 }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={(value) => setCollapsed(value)}
          width={240}
          style={{
            overflow: 'auto',
            height: '100%',
          }}
        >
          <div
            style={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: collapsed ? 18 : 20,
              fontWeight: 600,
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {collapsed ? <FileTextOutlined /> : t('app.brand')}
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            style={{ borderRight: 0 }}
          />
        </Sider>

        <Layout style={{ minHeight: 0 }}>
          <Content
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              padding: 24,
            }}
          >
            <div
              style={{
                height: '100%',
                minHeight: 0,
                overflow: 'auto',
                padding: 24,
                background: colorBgContainer,
                borderRadius: 8,
              }}
            >
              <LicenseGate needsSetup={needsSetup}>
                <Outlet />
              </LicenseGate>
            </div>
          </Content>
        </Layout>
      </Layout>
    </div>
  );
}
