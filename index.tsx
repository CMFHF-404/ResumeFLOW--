import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogtoProvider, LogtoConfig, UserScope } from '@logto/react';
import App from './App';
import ExperienceBankPdfExportPage from './views/ExperienceBankPdfExportPage';
import ResumePdfExportPage from './views/ResumePdfExportPage';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const resolveLogtoAccountApiResource = () => {
  const configuredResource = import.meta.env.VITE_LOGTO_ACCOUNT_API_RESOURCE?.trim();
  if (configuredResource) {
    return trimTrailingSlash(configuredResource);
  }

  const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT?.trim();
  return endpoint ? `${trimTrailingSlash(endpoint)}/api` : '';
};

const logtoResources = [
  import.meta.env.VITE_LOGTO_RESOURCE,
  resolveLogtoAccountApiResource(),
].filter((resource): resource is string => Boolean(resource));

const config: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT,
  appId: import.meta.env.VITE_LOGTO_APP_ID,
  scopes: [UserScope.Profile, UserScope.Email, UserScope.Phone, UserScope.Identities],
  resources: logtoResources,
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const isResumePdfExportPath = window.location.pathname === '/print/resume-export';
const isExperienceBankPdfExportPath =
  window.location.pathname === '/print/experience-bank-export';

// 在开发环境禁用严格模式，避免双重挂载导致重复请求
// 生产环境保留严格模式以检测潜在问题
const appContent = isResumePdfExportPath ? (
  <ResumePdfExportPage />
) : isExperienceBankPdfExportPath ? (
  <ExperienceBankPdfExportPage />
) : (
  <LogtoProvider config={config}>
    <App />
  </LogtoProvider>
);

root.render(
  import.meta.env.PROD ? <React.StrictMode>{appContent}</React.StrictMode> : appContent
);
