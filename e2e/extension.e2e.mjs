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
  const runJob = async (videoId, extra = '') => {
    const yt = await ctx.newPage();
    await yt.goto(`${MOCK}/watch?v=${videoId}`);
    const tabId = await tabIdFor(`${MOCK}/watch*`);
    const job = await ctx.newPage();
    await job.goto(ext(`job.html?tab=${tabId}${extra}`));
    return { yt, job };
  };
  const chatTabsOpened = () => settings.evaluate(async (u) => (await chrome.tabs.query({ url: u })).length, `${MOCK}/chat*`);

  // popup: choosing the AI is remembered
  const pop = await ctx.newPage();
  await pop.goto(ext('popup.html'));
  await pop.click('[data-provider="claude"]');
  ok('popup switches to Claude', (await pop.getAttribute('[data-provider="claude"]', 'aria-checked')) === 'true');
  ok('choice is saved', (await settings.evaluate(async () => (await chrome.storage.local.get('settings')).settings.provider)) === 'claude');
  await pop.click('[data-provider="chatgpt"]');
  ok('and back to ChatGPT', (await settings.evaluate(async () => (await chrome.storage.local.get('settings')).settings.provider)) === 'chatgpt');
  await pop.close();

  // ---- 1. full automatic run --------------------------------------------------------------------
  const { yt, job } = await runJob('kRq3WzSwUw0');
  await job.waitForSelector('[data-step="app"][data-state="done"], [data-state="error"]', { timeout: 90_000 });
  const states = await job.$$eval('.steps li', (lis) => lis.map((li) => `${li.dataset.step}:${li.dataset.state}:${li.querySelector('.detail').textContent}`));
  states.forEach((s) => console.log('      ', s));
  ok('all four steps done', states.every((s) => s.split(':')[1] === 'done'));
  ok('transcript read from the panel', /\d+ transcript segments/.test(states[0]) && states[0].includes('Deutsch'));
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
    const texts = await app.locator('.vid-row-text').allInnerTexts();
    ok('no repeated lines although the page listed the transcript twice', new Set(texts).size === texts.length && texts.join(' ').split('Hallo').length === 2, JSON.stringify(texts));
    ok('phrases are shown under the line', /phrase meaning/.test(await app.locator('.vid-phrases').first().innerText().catch(() => '')));
    ok('title and channel from YouTube', /Beim Bäcker/.test(await app.locator('.vid-title').innerText()) && /Test Kanal/.test(await app.locator('.vid-main').innerText()));
  }

  // the files offered on the job page match
  const [dl] = await Promise.all([job.waitForEvent('download'), job.click('#dl-json')]);
  const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('downloadable .json is a valid video file', saved.kind === 'video' && saved.video.id === 'kRq3WzSwUw0' && saved.segments.every((s) => s.translation));
  ok('timing comes from YouTube, not the AI', saved.segments[0].start === 0 && saved.segments.at(-1).start >= 20);
  await yt.close();

  // ---- 1b. same video again: no AI, straight to the app from the saved library -------------------
  ok('finished video saved in the extension library', (await settings.evaluate(async () => !!(await chrome.storage.local.get('video:kRq3WzSwUw0'))['video:kRq3WzSwUw0'])));
  for (const pg of ctx.pages()) if (pg.url().startsWith(APP_URL)) await pg.close();
  const again = await runJob('kRq3WzSwUw0', '&video=kRq3WzSwUw0');
  await again.job.waitForSelector('[data-step="app"][data-state="done"], [data-step="app"][data-state="error"]', { timeout: 30_000 });
  ok('second run reuses the saved subtitles', /Saved earlier/.test(await again.job.locator('[data-step="build"] .detail').innerText()));
  ok('second run does not open the AI chat', (await chatTabsOpened()) === 0);
  ok('second run opens the video in the app', ctx.pages().some((pg) => pg.url().includes('/#/videos/yt-kRq3WzSwUw0')));
  await again.yt.close();

  // ---- 1c. "Create again" redoes it --------------------------------------------------------------
  const redo = await runJob('kRq3WzSwUw0', '&video=kRq3WzSwUw0&mode=new');
  await redo.job.waitForSelector('[data-step="ai"][data-state="active"], [data-step="ai"][data-state="done"]', { timeout: 30_000 });
  await redo.job.waitForSelector('[data-step="app"][data-state="done"], [data-state="error"]', { timeout: 90_000 });
  ok('"Create again" goes through the AI again', /translated in/.test(await redo.job.locator('[data-step="ai"] .detail').innerText()));
  await redo.yt.close();

  // ---- 1d. lesson from the video: separate job, normal lesson format --------------------------------
  const pop2 = await ctx.newPage();
  const ytForPopup = await ctx.newPage();
  await ytForPopup.goto(`${MOCK}/watch?v=kRq3WzSwUw0`);
  const popupTab = await tabIdFor(`${MOCK}/watch*`);
  await pop2.goto(ext(`popup.html?tab=${popupTab}`));
  ok('popup offers a separate lesson button', /lesson from this video/i.test(await pop2.locator('#lesson').innerText()));
  await pop2.close().catch(() => {});
  await ytForPopup.close();
  for (const pg of ctx.pages()) if (pg.url().startsWith(APP_URL)) await pg.close();
  const les = await runJob('kRq3WzSwUw0', '&kind=lesson');
  await les.job.waitForSelector('[data-step="app"][data-state="done"], [data-state="error"]', { timeout: 90_000 });
  const lesStates = await les.job.$$eval('.steps li', (lis) => lis.map((li) => `${li.dataset.step}:${li.dataset.state}:${li.querySelector('.detail').textContent}`));
  lesStates.forEach((s) => console.log('      ', s));
  ok('lesson job: all steps done', lesStates.every((s) => s.split(':')[1] === 'done'));
  ok('lesson job is labelled as a lesson', /Write the lesson/.test(await les.job.locator('[data-step="ai"] b').innerText()));
  const lesLog = await les.job.locator('#log').textContent();
  ok('invalid lesson was sent back to the AI and fixed', /lesson has problems/.test(lesLog) && /fixed lesson: 5 words, 2 exercises/.test(lesLog));
  const lesApp = ctx.pages().find((pg) => pg.url().includes('/#/lessons/yt-kRq3WzSwUw0'));
  ok('app opened on the new lesson', !!lesApp, ctx.pages().map((p) => p.url()).join(' | '));
  if (lesApp) {
    await lesApp.waitForSelector('.stages');
    ok('lesson has the AI title and its words', /Beim Bäcker \(Lektion\)/.test(await lesApp.locator('h1').innerText()) && (await lesApp.locator('.row-item').count()) === 5);
    ok('lesson has a Sentences stage from the written examples', (await lesApp.locator('.stage-card').count()) === 2);
  }
  const [ldl] = await Promise.all([les.job.waitForEvent('download'), les.job.click('#dl-lesson')]);
  const lfile = JSON.parse(fs.readFileSync(await ldl.path(), 'utf8'));
  ok('downloadable lesson file uses the video id and link', lfile.id === 'yt-kRq3WzSwUw0' && /watch\?v=kRq3WzSwUw0/.test(lfile.source) && lfile.tags[0] === 'video');
  await les.yt.close();

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
