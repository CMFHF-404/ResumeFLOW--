import React from 'react';
import ReactDOM from 'react-dom/client';
import { PostHogProvider } from 'posthog-js/react';
import { LogtoProvider, LogtoConfig } from '@logto/react';
import App from './App';
import { buildPosthogConfig, isPosthogEnabled } from './utils/posthogConfig';

const config: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT,
  appId: import.meta.env.VITE_LOGTO_APP_ID,
  resources: [import.meta.env.VITE_LOGTO_RESOURCE],
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// 在开发环境禁用严格模式，避免双重挂载导致重复请求
// 生产环境保留严格模式以检测潜在问题
const appContent = (
  <LogtoProvider config={config}>
    <App />
  </LogtoProvider>
);

const posthogEnabled = isPosthogEnabled();
const posthogConfig = posthogEnabled ? buildPosthogConfig() : null;

const app = posthogEnabled && posthogConfig ? (
  <PostHogProvider apiKey={posthogConfig.apiKey} options={posthogConfig.options}>
    {appContent}
  </PostHogProvider>
) : (
  appContent
);

root.render(
  import.meta.env.PROD ? <React.StrictMode>{app}</React.StrictMode> : app
);
