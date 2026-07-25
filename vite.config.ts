import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://kfsalem.github.io/Dynasty-Trade-Calculator/
  base: '/Dynasty-Trade-Calculator/',
  plugins: [react(), tailwindcss()],
})
