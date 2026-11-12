import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', workers:1,
  use:{baseURL:'http://localhost:5180',channel:'msedge',headless:true},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5180',url:'http://localhost:5180',reuseExistingServer:false},
});
