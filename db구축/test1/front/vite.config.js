import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 프론트에서 '/api'로 호출하면 → http://localhost:5000으로 프록시
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
