// End-to-end test of the browser extension: loads the real built extension into Chromium and runs
// YouTube tab -> transcript -> AI chat -> app, against local mock pages (see mock-sites.mjs).
// Needs the app running (npm run dev -- --port 5174) and a test build:
//   EXTENSION_TEST_HOSTS="http://localhost:4599/*" npm run ext:build
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_URL, chromiumPath, here, reporter } from './lib.mjs';
import { startMockSites } from './mock-sites.mjs';

const MOCK = 'http://localhost:4599';
const extDir = here('..', 'extension', 'dist');
const { ok, done } = reporter();
const server = await startMockSites(4599);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deutsch-ext-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: chromiumPath(),
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1200, height: 850 },
});
const errors = [];
ctx.on('page', (pg) => pg.on('pageerror', (e) => errors.push(`${pg.url()}: ${e.message}`)));

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  ok('extension loaded', !!extId, extId);
  const ext = (p) => `chrome-extension://${extId}/${p}`;

  // settings
  const settings = await ctx.newPage();
  await settings.goto(ext('job.html?settings'));
  await settings.fill('input[name="chatUrl"]', `${MOCK}/chat`);
  await settings.fill('input[name="appUrl"]', APP_URL);
  await settings.fill('input[name="chunkSize"]', '5');
  await settings.click('#settings-form button[type="submit"]');
  await settings.waitForSelector('#saved:has-text("Saved")');
  ok('settings saved', true);

  const tabIdFor = (urlPattern) => settings.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, urlPattern);
  const runJob = async (videoId) => {
    const yt = await ctx.newPage();
    await yt.goto(`${MOCK}/watch?v=${videoId}`);
    const tabId = await tabIdFor(`${MOCK}/watch*`);
    const job = await ctx.newPage();
    await job.goto(ext(`job.html?tab=${tabId}`));
    return { yt, job };
  };

  // ---- 1. full automatic run --------------------------------------------------------------------
  const { yt, job } = await runJob('kRq3WzSwUw0');
  await job.waitForSelector('[data-step="app"][data-state="done"], [data-state="error"]', { timeout: 90_000 });
  const states = await job.$$eval('.steps li', (lis) => lis.map((li) => `${li.dataset.step}:${li.dataset.state}:${li.querySelector('.detail').textContent}`));
  states.forEach((s) => console.log('      ', s));
  ok('all four steps done', states.every((s) => s.split(':')[1] === 'done'));
  ok('transcript read from the panel (12 segments)', states[0].includes('12 transcript segments') && states[0].includes('Deutsch'));
  const logText = await job.locator('#log').textContent();
  ok('missing line was asked for again and recovered', /retry: 1\/1 recovered/.test(logText), logText.match(/retry.*$/m)?.[0] ?? '');
  ok('several chunks were sent', /part 2 of/.test(logText));
  ok('AI tab closed afterwards', !ctx.pages().some((pg) => pg.url().startsWith(`${MOCK}/chat`)));

  const app = ctx.pages().find((pg) => pg.url().includes('/#/videos/yt-kRq3WzSwUw0'));
  ok('app opened on the new video', !!app, ctx.pages().map((p) => p.url()).join(' | '));
  if (app) {
    await app.waitForSelector('.vid-row');
    const rows = await app.locator('.vid-row').count();
    ok('app shows the merged subtitle lines', rows >= 4 && rows <= 12, `${rows} rows`);
    await app.getByRole('button', { name: 'Show translation' }).click();
    const tr = await app.locator('.vid-row-tr').allInnerTexts();
    ok('every line has its translation', tr.length === rows && tr.every((t) => t.startsWith('EN: ')), JSON.stringify(tr.slice(0, 2)));
    ok('title and channel from YouTube', /Beim Bäcker/.test(await app.locator('.vid-title').innerText()) && /Test Kanal/.test(await app.locator('.vid-main').innerText()));
  }

  // the files offered on the job page match
  const [dl] = await Promise.all([job.waitForEvent('download'), job.click('#dl-json')]);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('downloadable .json is a valid video file', saved.kind === 'video' && saved.video.id === 'kRq3WzSwUw0' && saved.segments.every((s) => s.translation));
  ok('timing comes from YouTube, not the AI', saved.segments[0].start === 0 && saved.segments.at(-1).start >= 20);
  await yt.close();

  // ---- 2. no transcript on the page -> paste fallback ---------------------------------------------
  const run2 = await runJob('abcdefghijk');
  await run2.job.waitForSelector('#paste:not([hidden])', { timeout: 30_000 });
  ok('asks to paste when the transcript cannot be read', /Paste it below/.test(await run2.job.locator('[data-step="transcript"] .detail').innerText()));
  await run2.job.fill('#paste-text', '0:00\nGuten Morgen!\n0:03\nWie geht es dir?\n0:06\nMir geht es gut.');
  await run2.job.click('#paste-go');
  await run2.job.waitForSelector('[data-step="app"][data-state="done"], [data-step="app"][data-state="error"]', { timeout: 60_000 });
  ok('pasted transcript goes through the whole pipeline', (await run2.job.getAttribute('[data-step="app"]', 'data-state')) === 'done');
  await run2.yt.close();

  // ---- 3. app not reachable -> clear error, retry button and downloads -----------------------------
  await settings.goto(ext('job.html?settings'));
  await settings.fill('input[name="appUrl"]', 'http://localhost:4597');
  await settings.click('#settings-form button[type="submit"]');
  await settings.waitForSelector('#saved:has-text("Saved")');
  const run3 = await runJob('kRq3WzSwUw0');
  await run3.job.waitForSelector('[data-step="app"][data-state="error"]', { timeout: 120_000 });
  ok('unreachable app reported clearly', /Is the app running at http:\/\/localhost:4597/.test(await run3.job.locator('[data-step="app"] .detail').innerText()));
  ok('retry button and downloads offered', (await run3.job.isVisible('#send-again')) && (await run3.job.isVisible('#dl-json')));
} finally {
  done(errors.filter((e) => !e.includes('localhost:4597')));
  await ctx.close();
  server.close();
}
