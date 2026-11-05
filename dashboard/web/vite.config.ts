import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3100',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 显式绑定 IPv4：不指定时 Vite 只监听 ::1，代理请求会绕到别的进程上
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // 图表库单独成 chunk：它占了大头，且和业务代码基本不同步更新，
    // 拆开后浏览器缓存更稳定。只切 @antv / d3，避免出现循环 chunk。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@antv/') || id.includes('node_modules/d3-')) {
            return 'g2';
          }
          return undefined;
        },
      },
    },
  },
});
