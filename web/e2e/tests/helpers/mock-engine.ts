/**
 * Engine response mocks for deterministic tests.
 *
 * We intercept at the network layer (page.route) rather than swapping the
 * engine binary — this keeps the real WS / streaming code paths exercised
 * for the rest of the suite while letting each spec dictate its own LLM
 * output.
 */
import { Page, Route } from '@playwright/test';

const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:3000';

export const FAKE_SCENE = {
  id: 'scn_001',
  duration_ms: 2000,
  layers: [
    { type: 'text', text: 'Hello, world', x: 100, y: 100, font: 'Inter', size: 48 },
  ],
};

export const FAKE_GENERATE_RESPONSE = {
  job_id: 'job_e2e_001',
  status: 'complete',
  scenes: [FAKE_SCENE],
  theme: 'aurora',
  duration_ms: 2000,
  preview_url: '/api/preview/job_e2e_001',
};

export async function mockGenerate(page: Page, override?: Partial<typeof FAKE_GENERATE_RESPONSE>) {
  await page.route(`${ENGINE}/v1/generate`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...FAKE_GENERATE_RESPONSE, ...override }),
    });
  });
}

export async function mockBriefParse(page: Page, sceneCount: number) {
  await page.route(`${ENGINE}/v1/brief/parse`, async (route) => {
    const scenes = Array.from({ length: sceneCount }, (_, i) => ({
      ...FAKE_SCENE,
      id: `scn_${String(i + 1).padStart(3, '0')}`,
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'structured_script',
        scene_count: sceneCount,
        scenes,
      }),
    });
  });
}

export async function mockExport(page: Page) {
  await page.route(`${ENGINE}/v1/export/lottie`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        v: '5.7.0',
        fr: 60,
        ip: 0,
        op: 120,
        w: 1920,
        h: 1080,
        layers: [],
      }),
    });
  });

  await page.route(`${ENGINE}/v1/export/mp4`, async (route) => {
    // Smallest valid MP4 ftyp box — Playwright doesn't care about playback.
    const mp4Header = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // size + 'ftyp'
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // 'isom'
      0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // compat
      0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
    ]);
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      body: mp4Header,
    });
  });
}

export async function mockThemes(page: Page) {
  await page.route(`${ENGINE}/v1/themes`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        themes: [
          { id: 'aurora', name: 'Aurora', primary: '#10b981' },
          { id: 'noir', name: 'Noir', primary: '#1a1a1a' },
        ],
      }),
    });
  });
}

export async function mockCastLibrary(page: Page) {
  await page.route(`${ENGINE}/v1/cast/library*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        characters: [
          { id: 'char_alex', name: 'Alex', avatar: '/cast/alex.png', tags: ['narrator'] },
          { id: 'char_blair', name: 'Blair', avatar: '/cast/blair.png', tags: ['villain'] },
          { id: 'char_chris', name: 'Chris', avatar: '/cast/chris.png', tags: ['hero'] },
        ],
      }),
    });
  });
}
