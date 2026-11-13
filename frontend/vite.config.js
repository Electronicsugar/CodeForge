import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // y-monaco 0.1.6 uses Monaco's pre-0.57 deep import. Resolve that single
  // compatibility path to the current public export, without patching vendors.
  resolve: {alias:[{find:'monaco-editor/esm/vs/editor/editor.api.js',replacement:'monaco-editor/editor/editor.api.js'}]},
})
