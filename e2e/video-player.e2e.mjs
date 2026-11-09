// End-to-end test of the Videos tab against a simulated YouTube player (controllable time and state).
// Needs the app running: npm run dev -- --port 5174   (or set APP_URL)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_URL, here, launch, reporter } from './lib.mjs';

const b = await launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const { ok, done } = reporter();

// Stand-in for window.YT so playback can be driven deterministically.
await p.addInitScript(() => {
  window.YT = {
    Player: class {
      constructor(el, o) {
        this.o = o;
        this.t = o.playerVars.start || 0;
        this.state = -1;
        this.rate = 1;
        window.__fake = this;
        this.timer = setInterval(() => { if (this.state === 1) this.t += 0.1 * this.rate; }, 100);
        setTimeout(() => o.events.onReady({ target: this }), 30);
      }
      playVideo() { this.state = 1; this.o.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.state = 2; this.o.events.onStateChange({ data: 2 }); }
      seekTo(s) { this.t = s; }
      getCurrentTime() { return this.t; }
      getDuration() { return 100; }
      getPlayerState() { return this.state; }
      setPlaybackRate(r) { this.rate = r; }
      getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25]; }
      destroy() { clearInterval(this.timer); }
    },
  };
});

const B = `${APP_URL}/#`;
const sleep = (ms) => p.waitForTimeout(ms);
const fake = (fn, arg) => p.evaluate(fn, arg);
const line = async () => (await p.locator('.vid-line').first().innerText()).trim();
const play = () => p.getByRole('button', { name: 'Play', exact: true }).click();
/** Jump close to a time, let one poll register it, then let playback run naturally. */
const approach = async (t, runMs = 700) => { await fake((x) => { window.__fake.t = x; }, t); await sleep(250); await sleep(runMs); };

await p.goto(`${B}/videos`);
await p.waitForSelector('.empty');
ok('Videos tab with empty state', (await p.locator('.nav-link', { hasText: 'Videos' }).count()) === 1);
await p.setInputFiles('input[type=file]', here('fixtures', 'video.json'));
await p.waitForSelector('.vid-layout');
await sleep(300);
ok('JSON import opens the player', p.url().includes('/videos/yt-kRq3WzSwUw0'));
ok('starts on the first line', /Hallo/.test(await line()));

await play(); await sleep(150);
ok('play starts the player', (await fake(() => window.__fake.state)) === 1);

await fake(() => { window.__fake.t = 17; }); await sleep(300);
ok('subtitle follows the time', /Brot/.test(await line()), await line());
ok('transcript row follows', /Brot/.test(await p.locator('.vid-row.active').innerText()));

await fake(() => { window.__fake.t = 9; }); await sleep(300);
const marked = await p.locator('.vid-bar .vid-gloss').allInnerTexts();
ok('separable verb "steht ... auf" highlighted in both parts', marked.some((t) => t.startsWith('steht')) && marked.some((t) => t.startsWith('auf')), JSON.stringify(marked));

// loop
await p.keyboard.press('l');
await approach(15.6);
ok('loop jumps back to the line start', (await fake(() => window.__fake.t)) < 12, String(await fake(() => window.__fake.t)));
ok('still playing while looping', (await fake(() => window.__fake.state)) === 1);
await p.keyboard.press('l');

// pause after each line
await fake(() => { window.__fake.t = 12; }); await sleep(250);
await p.keyboard.press('a');
await approach(15.6);
ok('pauses at the end of the line', (await fake(() => window.__fake.state)) === 2);
await play(); await sleep(500);
ok('resumes without pausing the same line again', (await fake(() => window.__fake.state)) === 1);
await approach(23.6);
ok('pauses again at the end of the next line', (await fake(() => window.__fake.state)) === 2);

let missed = 0;
for (const startAt of [23.3, 23.37, 23.44, 23.51, 23.58, 23.65, 23.72, 23.79, 23.86]) {
  await fake(() => { window.__fake.t = 5; }); await sleep(250); // leave the line
  await play(); await sleep(100);
  await approach(startAt, 1300);
  if ((await fake(() => window.__fake.state)) !== 2) missed++;
}
ok('line end never missed across 9 timer phases', missed === 0, `missed ${missed}`);
await p.keyboard.press('a');

// navigation
await fake(() => { window.__fake.t = 17; }); await play(); await sleep(250);
await p.getByRole('button', { name: 'Next line' }).click(); await sleep(200);
ok('next line seeks to its start', Math.abs((await fake(() => window.__fake.t)) - 24) < 0.6);
await p.keyboard.press('ArrowLeft'); await sleep(250);
ok('ArrowLeft goes to the previous line', Math.abs((await fake(() => window.__fake.t)) - 16) < 0.6);
await fake(() => { window.__fake.t = 20; }); await sleep(250);
await p.keyboard.press('r'); await sleep(200);
ok('R replays the current line', Math.abs((await fake(() => window.__fake.t)) - 16) < 0.6);
await p.keyboard.press(' '); await sleep(200);
ok('Space pauses (even right after clicking a control)', (await fake(() => window.__fake.state)) === 2);
await p.keyboard.press(' '); await sleep(200);
ok('Space plays again', (await fake(() => window.__fake.state)) === 1);
// A button that keeps keyboard focus (e.g. reached with Tab) must not take over Space or the arrows.
await p.getByRole('button', { name: 'Next line' }).focus();
const tBefore = await fake(() => window.__fake.t);
await p.keyboard.press(' '); await sleep(200);
ok('Space pauses even when a button has focus', (await fake(() => window.__fake.state)) === 2
  && Math.abs((await fake(() => window.__fake.t)) - tBefore) < 0.6);
await p.keyboard.press(' '); await sleep(200);
ok('Space plays again with a button focused', (await fake(() => window.__fake.state)) === 1);
await fake(() => { window.__fake.t = 17; }); await sleep(250);
await p.getByRole('button', { name: '0.75×' }).focus();
await p.keyboard.press('ArrowRight'); await sleep(250);
ok('ArrowRight goes to the next line with a button focused', Math.abs((await fake(() => window.__fake.t)) - 24) < 0.6);
await p.keyboard.press('ArrowLeft'); await sleep(250);
ok('ArrowLeft goes back with a button focused', Math.abs((await fake(() => window.__fake.t)) - 16) < 0.6);

await p.getByRole('button', { name: '0.75×' }).click();
ok('speed 0.75×', (await fake(() => window.__fake.rate)) === 0.75);

// translation and word panel
await p.keyboard.press(' '); await fake(() => { window.__fake.t = 17; }); await sleep(250);
ok('translation hidden by default', (await p.locator('.vid-translation').count()) === 0);
await p.keyboard.press('t');
ok('T shows the translation', /He buys bread/.test(await p.locator('.vid-translation').innerText()));
ok('glossary word not found in the line is still listed', /Pizza/.test(await p.locator('.vid-extra').innerText()));
await fake(() => { window.__fake.t = 9; window.__fake.state = 1; }); await sleep(250);
await p.locator('.vid-bar .vid-gloss').first().hover();
ok('hover shows the meaning', await p.locator('.vid-bar .gloss-tip').first().isVisible());
await p.locator('.vid-bar .vid-gloss').first().click();
ok('clicking a word pauses and shows its meaning', (await fake(() => window.__fake.state)) === 2 && (await p.locator('.vid-picked').isVisible()));
await p.getByRole('button', { name: 'Close' }).first().click();
ok('word panel closes', (await p.locator('.vid-picked').count()) === 0);

// phrases + dictionary form + lesson
await fake(() => { window.__fake.t = 9; }); await sleep(300);
ok('phrase with its explanation shown under the line', /up early · literally: early up/.test(await p.locator('.vid-phrases').innerText()));
const tips = await p.locator('.vid-bar .gloss-tip').allTextContents();
ok('tooltip shows the dictionary form too', tips.some((t) => t === 'the baker · der Bäcker'), JSON.stringify(tips));
const [ly] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Lesson file/ }).click()]);
const yamlText = fs.readFileSync(await ly.path(), 'utf8');
ok('lesson file downloads in the lesson format, words only', /^schema_version: 1/m.test(yamlText) && /items:/.test(yamlText) && !/type: /.test(yamlText) && !/example:/.test(yamlText));

// SRT download
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /^SRT/ }).click()]);
ok('SRT download', /00:00:08,000 --> 00:00:16,000/.test(fs.readFileSync(await dl.path(), 'utf8')));

// create a lesson from the video, then come back
await p.getByRole('button', { name: /Create lesson/ }).click();
await p.waitForSelector('.stages');
ok('Create lesson opens a lesson built from the video', p.url().includes('/lessons/video-kRq3WzSwUw0') && /Video · Test video/.test(await p.locator('h1').innerText()));
const words = await p.locator('.row-item').allInnerTexts();
ok('lesson has the video words with articles', words.some((w) => /der\s+Bäcker/.test(w)) && words.some((w) => /aufstehen/.test(w)), `${words.length} words`);
ok('video lesson is words only, without a Sentences stage or tabs',
  (await p.locator('.stage-card').count()) === 1 && (await p.getByRole('tab').count()) === 0);
const titles = await p.locator('.row-title').allInnerTexts();
ok('every word is listed once', new Set(titles).size === titles.length, `${titles.length} items`);
await p.goto(`${B}/videos/yt-kRq3WzSwUw0`); await p.waitForSelector('.vid-layout'); await sleep(400);

// resume position
await play(); await fake(() => { window.__fake.t = 26; }); await sleep(5600);
const saved = await p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('german-learner');
  r.onsuccess = () => { const q = r.result.transaction('videos').objectStore('videos').get('yt-kRq3WzSwUw0'); q.onsuccess = () => res(q.result.lastTime); };
}));
ok('position saved while playing', saved > 25 && saved < 40, String(saved));
await p.goto(`${B}/videos`);
await p.locator('.video-card a.video-thumb').click();
await p.waitForSelector('.vid-layout'); await sleep(400);
ok('reopening resumes near the saved position', (await fake(() => window.__fake.o.playerVars.start)) >= 22);
ok('YouTube fullscreen off, privacy host used', (await fake(() => window.__fake.o.playerVars.fs)) === 0 && (await fake(() => window.__fake.o.host)) === 'https://www.youtube-nocookie.com');

await fake(() => window.__fake.o.events.onError({ data: 150 })); await sleep(200);
ok('embed-disabled error explained with a YouTube link', /does not allow it to be embedded/.test(await p.locator('.vid-error').innerText()));

// extension hand-off envelope
await p.goto(`${B}/videos`); await p.waitForSelector('.video-card');
const payload = JSON.parse(fs.readFileSync(here('fixtures', 'video.json'), 'utf8'));
payload.title = 'Delivered by extension';
payload.video.id = 'Lfoai_nP7lc';
const ack = await p.evaluate((payload) => new Promise((resolve) => {
  window.addEventListener('message', (e) => { if (e.data?.source === 'deutsch-app' && e.data.type === 'video-import-result') resolve(e.data); });
  window.postMessage({ source: 'deutsch-extension', type: 'video-import', requestId: 'r1', payload }, window.location.origin);
}), payload);
ok('bridge accepts and acknowledges a valid payload', ack.ok === true && ack.id === 'yt-Lfoai_nP7lc');
await p.waitForSelector('.vid-layout');
ok('bridge opens the new video', p.url().includes('yt-Lfoai_nP7lc'));
const replies = await p.evaluate(() => new Promise((resolve) => {
  const seen = [];
  window.addEventListener('message', (e) => { if (e.data?.type === 'video-import-result') seen.push(e.data); });
  window.postMessage({ source: 'someone-else', type: 'video-import', requestId: 'x', payload: {} }, window.location.origin);
  window.postMessage({ source: 'deutsch-extension', type: 'video-import', requestId: 'bad', payload: { kind: 'video' } }, window.location.origin);
  setTimeout(() => resolve(seen), 600);
}));
ok('foreign messages ignored, invalid payload rejected', replies.length === 1 && replies[0].requestId === 'bad' && replies[0].ok === false);

// plain .srt
await p.goto(`${B}/videos`); await p.waitForSelector('.video-card');
const srtPath = path.join(os.tmpdir(), 'deutsch-e2e-plain.srt');
fs.writeFileSync(srtPath, '1\n00:00:01,000 --> 00:00:03,000\nGuten Morgen!\n\n2\n00:00:03,500 --> 00:00:06,000\nWie geht es dir?\n');
await p.setInputFiles('input[type=file]', srtPath);
await p.fill('input[placeholder="YouTube link"]', 'https://youtu.be/g_h1DtGIAfQ');
await p.getByRole('button', { name: 'Import' }).click();
await p.waitForSelector('.vid-layout');
ok('plain .srt import asks for the link and works', p.url().includes('yt-g_h1DtGIAfQ') && (await p.locator('.vid-row').count()) === 2);

// delete
await p.goto(`${B}/videos`); await p.waitForSelector('.video-card');
const before = await p.locator('.video-card').count();
p.once('dialog', (d) => d.accept());
await p.locator('.video-card .icon-btn.danger').first().click(); await sleep(300);
ok('delete removes a video', (await p.locator('.video-card').count()) === before - 1);

await p.setViewportSize({ width: 390, height: 800 });
await p.locator('.video-card a.video-thumb').first().click(); await p.waitForSelector('.vid-layout'); await sleep(300);
ok('no horizontal scroll on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

done(errors);
await b.close();
