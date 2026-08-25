/// <reference types="node" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

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
          // React is shared by every route and large enough to obscure changes
          // in the application entry. Keep only this truly eager runtime in a
          // stable vendor chunk; route-only libraries remain with lazy routes.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-dom/client'],
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
          target: env.VITE_API_BASE_URL || 'http://localhost:8000',
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
