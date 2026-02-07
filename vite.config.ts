import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:8000';

  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: ['.cpolar.top', '.localtunnel.me', '.ngrok.io', '.loca.lt'],
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (pathValue) => pathValue.replace(/^\/api/, ''),
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
