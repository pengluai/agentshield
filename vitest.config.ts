import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tauri-apps/api/core': path.resolve(__dirname, './src/test/__mocks__/tauri-core.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, './src/test/__mocks__/tauri-event.ts'),
      '@tauri-apps/api/app': path.resolve(__dirname, './src/test/__mocks__/tauri-app.ts'),
      '@tauri-apps/api/window': path.resolve(__dirname, './src/test/__mocks__/tauri-window.ts'),
      '@tauri-apps/plugin-shell': path.resolve(__dirname, './src/test/__mocks__/tauri-plugin-shell.ts'),
      '@tauri-apps/plugin-notification': path.resolve(__dirname, './src/test/__mocks__/tauri-plugin-notification.ts'),
      '@tauri-apps/plugin-autostart': path.resolve(__dirname, './src/test/__mocks__/tauri-plugin-autostart.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
