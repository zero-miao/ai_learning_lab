import { defineConfig, devices } from '@playwright/test';

const databasePath = '/tmp/ai-learning-lab-browser-regression.sqlite3';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:15173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: [
        `rm -f ${databasePath}`,
        `DJANGO_DATABASE_PATH=${databasePath} ../.venv/bin/python manage.py migrate --noinput`,
        `DJANGO_DATABASE_PATH=${databasePath} ../.venv/bin/python manage.py seed_browser_regression`,
        `DJANGO_DATABASE_PATH=${databasePath} ../.venv/bin/python manage.py runserver 127.0.0.1:18000 --noreload`,
      ].join(' && '),
      cwd: '../backend',
      url: 'http://127.0.0.1:18000/api/health/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'VITE_API_PROXY_TARGET=http://127.0.0.1:18000 npm run dev -- --host 127.0.0.1 --port 15173',
      cwd: '.',
      url: 'http://127.0.0.1:15173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
