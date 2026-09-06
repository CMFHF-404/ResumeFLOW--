/// <reference types="node" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const templateSelectorModule = path
    .resolve(__dirname, 'views/ResumeEditor/components/TemplateSelectorModal.tsx')
    .replaceAll('\\', '/');
  // Browser code always uses the production-safe same-origin /api mount. The
  // Vite development proxy needs a separate server-side upstream instead.
  const devApiProxyTarget = env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:8000';

  return {
    plugins: [react()],
    define: {
      // One build-time authority feeds both the browser checkout guard and the
      // Nginx form-action manifest; do not introduce a second payment origin.
      'import.meta.env.VITE_YIFUT_BASE_URL': JSON.stringify(
        env.YIFUT_BASE_URL || 'https://www.yifut.com',
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
      rollupOptions: {
        output: {
          // Assign only the named modules. Letting Rollup absorb their entire
          // dependency trees can pull route-only UI back into the app entry.
          onlyExplicitManualChunks: true,
          manualChunks(moduleId) {
            const normalizedId = moduleId.replaceAll('\\', '/').split('?')[0];
            if (normalizedId === templateSelectorModule) {
              return 'resume-template-selector';
            }
            if (
              normalizedId.includes('/node_modules/react/')
              || normalizedId.includes('/node_modules/react-dom/')
              || normalizedId.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    // 开发服务器配置（仅用于本地开发）
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: ['.cpolar.top', '.localtunnel.me', '.ngrok.io', '.loca.lt'],
      proxy: {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
          rewrite: (pathValue) => pathValue.replace(/^\/api/, ''),
          // 比后端 AI_TIMEOUT_SECONDS=300 多预留 10 秒，避免代理先于后端超时
          proxyTimeout: 310_000,
          timeout: 310_000,
        },
      },
    },
  };
});
