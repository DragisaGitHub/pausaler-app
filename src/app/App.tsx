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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from './i18n';
import { getStorage } from './services/storageProvider';
import { SetupCompanyPage } from './pages/SetupCompanyPage';

const storage = getStorage();

export default function App() {
  const { i18n: i18nFromHook } = useTranslation();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const settings = await storage.getSettings();
      const shouldSetup = settings.isConfigured !== true;
      setNeedsSetup(shouldSetup);

      const lang = normalizeLanguage(settings.language);
      if (i18n.language !== lang) {
        void i18n.changeLanguage(lang);
      }
    })();
  }, []);

  const appLang = normalizeLanguage(i18nFromHook.language);
  const antdLocale = appLang === 'en' ? enUS : srRS;

  if (needsSetup === null) return null;

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
          <Route path="/" element={<MainLayout needsSetup={needsSetup} />}>
            <Route
              path="setup"
              element={
                <SetupCompanyPage
                  onCompleted={() => {
                    setNeedsSetup(false);
                  }}
                />
              }
            />
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