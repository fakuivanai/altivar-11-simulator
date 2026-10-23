import { defineConfig } from '@playwright/test';
const chromium = {
  browserName: 'chromium',
  launchOptions: {
    executablePath: process.env.BROWSER_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  }
};
const firefox = {
  browserName: 'firefox',
  headless: !process.env.DISPLAY,
  launchOptions: {
    executablePath: process.env.FIREFOX_PATH,
    firefoxUserPrefs: {
      'webgl.force-enabled': true
    }
  }
};
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: true,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: process.env.TEST_OUTPUT_DIR || 'test-results',
  reporter: [['list']],
  use: {
    viewport: {
      width: 1280,
      height: 720
    },
    acceptDownloads: true,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/helpers/serve.mjs',
    url: 'http://127.0.0.1:' + (process.env.VFD_TEST_PORT || 4173) + '/classroom/drive-simulator/index.html',
    reuseExistingServer: !process.env.CI
  },
  projects: [...['file', 'http'].flatMap(transport => [{
    name: 'chromium-' + transport,
    testMatch: "**/*.spec.mjs",
    testIgnore: "**/mobile.spec.mjs",
    metadata: {
      transport
    },
    use: chromium
  }, {
    name: 'firefox-' + transport,
    testMatch: "**/*.spec.mjs",
    testIgnore: "**/mobile.spec.mjs",
    metadata: {
      transport
    },
    use: firefox
  }]), {
    name: 'phone-landscape',
    testMatch: '**/mobile.spec.mjs',
    metadata: {
      transport: 'file'
    },
    use: {
      ...chromium,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      viewport: {
        width: 568,
        height: 240
      }
    }
  }, {
    name: 'phone-ultrawide',
    testMatch: '**/mobile.spec.mjs',
    metadata: {
      transport: 'http'
    },
    use: {
      ...chromium,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      viewport: {
        width: 1024,
        height: 256
      }
    }
  }]
});
