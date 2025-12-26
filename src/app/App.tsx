import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import srRS from 'antd/locale/sr_RS';
import { MainLayout } from './layouts/MainLayout';
import { InvoicesPage } from './pages/InvoicesPage';
import { NewInvoicePage } from './pages/NewInvoicePage';
import { InvoiceViewPage } from './pages/InvoiceViewPage';
import { ClientsPage } from './pages/ClientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from './i18n';
import { settingsService } from './services/storage';

export default function App() {
  const { i18n: i18nFromHook } = useTranslation();

  useEffect(() => {
    const settings = settingsService.get();
    const lang = normalizeLanguage(settings.language);
    if (i18n.language !== lang) {
      void i18n.changeLanguage(lang);
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_DEMO_SEED === 'true') {
      void import('./services/seedData');
    }
  }, []);

  const appLang = normalizeLanguage(i18nFromHook.language);
  const antdLocale = appLang === 'en' ? enUS : srRS;

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 6,
          fontSize: 14,
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<InvoicesPage />} />
            <Route path="invoices/new" element={<NewInvoicePage />} />
            <Route path="invoices/view/:id" element={<InvoiceViewPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}