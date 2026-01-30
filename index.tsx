import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogtoProvider, LogtoConfig } from '@logto/react';
import App from './App';

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
const app = (
  <LogtoProvider config={config}>
    <App />
  </LogtoProvider>
);

root.render(
  import.meta.env.PROD ? <React.StrictMode>{app}</React.StrictMode> : app
);
