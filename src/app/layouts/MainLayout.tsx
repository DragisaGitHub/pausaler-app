import { useState } from 'react';
import { Layout, Menu, theme } from 'antd';
import { FileTextOutlined, UserOutlined, SettingOutlined, DashboardOutlined } from '@ant-design/icons';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Header, Sider, Content } = Layout;

export function MainLayout({ needsSetup = false }: { needsSetup?: boolean }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      disabled: needsSetup,
      label: needsSetup ? <span>{t('nav.invoices')}</span> : <Link to="/">{t('nav.invoices')}</Link>,
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
      label: needsSetup ? <span>{t('nav.settings')}</span> : <Link to="/settings">{t('nav.settings')}</Link>,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        width={240}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'sticky',
          left: 0,
          top: 0,
          bottom: 0,
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
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
            {t('app.title')}
          </h1>
        </Header>
        <Content style={{ margin: '24px', minHeight: 280 }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: 8,
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
