// The job page: runs the whole pipeline for one YouTube tab and shows its progress.
// YouTube tab -> transcript -> AI chat (chunk by chunk) -> validated subtitle file -> Deutsch Trainer.
import { buildVideoFile } from '../../src/core/video/build';
import { mergeCues, type Line } from '../../src/core/video/lines';
import { buildPrompt, buildRetryPrompt, chunkLines, missingLines, parseAiReply, type AiItem } from '../../src/core/video/prompt';
import { normalizeVideo, type VideoFile } from '../../src/core/video/schema';
import { parseTranscriptText, toSrt, type Cue } from '../../src/core/video/subtitles';
import type { AiAskResult, AppDeliverResult } from './messages';
import { PROVIDERS, chatUrlFor, loadSettings, saveSettings, type ExtSettings } from './settings';
import { scrapeYouTube, type ScrapedVideo } from './youtube-scrape';

type Step = 'transcript' | 'ai' | 'build' | 'app';
type State = 'active' | 'done' | 'error';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(name: Step, state: State, detail?: string) {
  const li = $(`[data-step="${name}"]`);
  li.dataset.state = state;
  if (detail !== undefined) (li.querySelector('.detail') as HTMLElement).textContent = detail;
}
function progress(done: number, total: number) {
  const bar = $('[data-step="ai"] .bar');
  bar.hidden = false;
  ($('[data-step="ai"] .bar-fill') as HTMLElement).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
}
function log(msg: string) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('#log').appendChild(li);
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- settings form -------------------------------------------------------------------------------

async function initSettingsForm(open: boolean) {
  const form = $<HTMLFormElement>('#settings-form');
  const s = await loadSettings();
  for (const [key, value] of Object.entries(s)) {
    const field = form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
  ($('#settings') as HTMLDetailsElement).open = open;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const el of [...form.elements] as (HTMLInputElement | HTMLSelectElement)[]) {
      if (!el.name) continue;
      patch[el.name] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    }
    await saveSettings(patch as Partial<ExtSettings>);
    $('#saved').textContent = 'Saved';
    setTimeout(() => ($('#saved').textContent = ''), 1500);
  });
}

// ---- tab helpers ---------------------------------------------------------------------------------

async function waitForTabLoaded(tabId: number, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(300);
  }
  throw new Error('The page took too long to load.');
}

/** Sends a message to a tab's content script, retrying while the script is still loading. */
async function sendToTab<T>(tabId: number, message: unknown, attempts = 40): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (e) {
      lastError = e;
      await sleep(500);
    }
  }
  throw new Error(`Could not reach the page: ${errorText(lastError)}`);
}

// ---- step 1: transcript ----------------------------------------------------------------------------

function askForPastedTranscript(): Promise<Cue[]> {
  const box = $('#paste');
  box.hidden = false;
  $<HTMLTextAreaElement>('#paste-text').focus();
  return new Promise((resolve) => {
    $('#paste-go').onclick = () => {
      const cues = parseTranscriptText($<HTMLTextAreaElement>('#paste-text').value);
      if (!cues.length) {
        $('#paste-error').textContent = 'No timestamps found. Copy the transcript including its times.';
        return;
      }
      box.hidden = true;
      resolve(cues);
    };
  });
}

async function readTranscript(tabId: number, s: ExtSettings): Promise<{ meta: ScrapedVideo['meta']; cues: Cue[] }> {
  step('transcript', 'active', 'Reading from the YouTube tab…');
  let scraped: ScrapedVideo | undefined;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: scrapeYouTube, args: [s.sourceLang] });
    scraped = res?.result as ScrapedVideo | undefined;
  } catch (e) {
    log(`could not run in the YouTube tab: ${errorText(e)}`);
  }
  scraped?.log.forEach(log);
  if (scraped?.meta.videoId) showVideo(scraped.meta);
  if (scraped?.ok && scraped.cues.length) {
    step('transcript', 'done', `${scraped.cues.length} transcript segments${scraped.language ? ` · ${scraped.language}` : ''}`);
    return { meta: scraped.meta, cues: scraped.cues };
  }
  if (!scraped?.meta.videoId) throw new Error('That tab is not a YouTube video. Open a video and start again from there.');
  step('transcript', 'error', `${scraped.error ?? 'Could not read the transcript.'} Paste it below to continue.`);
  const cues = await askForPastedTranscript();
  step('transcript', 'done', `${cues.length} segments from pasted text`);
  return { meta: scraped.meta, cues };
}

function showVideo(meta: ScrapedVideo['meta']) {
  $('#title').textContent = meta.title;
  $('#subtitle').textContent = [meta.channel, meta.duration ? `${Math.round(meta.duration / 60)} min` : ''].filter(Boolean).join(' · ');
  const img = $<HTMLImageElement>('#thumb');
  img.src = `https://i.ytimg.com/vi/${meta.videoId}/mqdefault.jpg`;
  img.hidden = false;
  document.title = `Subtitles · ${meta.title}`;
}

// ---- step 2: AI --------------------------------------------------------------------------------------

async function translate(lines: Line[], s: ExtSettings, title: string): Promise<{ replies: AiItem[]; aiTabId: number }> {
  const provider = PROVIDERS[s.provider].name;
  const chunks = chunkLines(lines, { maxLines: s.chunkSize });
  const options = { level: s.level, sourceLanguage: s.sourceLanguage, targetLanguage: s.targetLanguage, title };
  step('ai', 'active', `Opening ${provider}…`);
  const tab = await chrome.tabs.create({ url: chatUrlFor(s), active: true });
  const aiTabId = tab.id!;
  await waitForTabLoaded(aiTabId);
  const ping = await sendToTab<{ ok: boolean; site: string }>(aiTabId, { type: 'ai:ping' });
  log(`connected to ${ping.site} (${chatUrlFor(s)})`);

  const replies: AiItem[] = [];
  for (const chunk of chunks) {
    const label = `part ${chunk.index + 1} of ${chunks.length}`;
    step('ai', 'active', `Sending ${label} (${chunk.lines.length} lines)…`);
    progress(chunk.index, chunks.length);
    let res = await sendToTab<AiAskResult>(aiTabId, { type: 'ai:ask', prompt: buildPrompt(chunk, chunks.length, options) }, 3);
    if (!res.ok) throw new Error(res.error);
    let items = parseAiReply(res.text);
    log(`${label}: ${items.length}/${chunk.lines.length} lines answered (${res.via})`);
    let missing = missingLines(chunk, items);
    if (missing.length) {
      step('ai', 'active', `Asking again for ${missing.length} missing line(s) of ${label}…`);
      res = await sendToTab<AiAskResult>(aiTabId, { type: 'ai:ask', prompt: buildRetryPrompt(missing, chunk, options) }, 3);
      if (res.ok) {
        const more = parseAiReply(res.text).filter((x) => missing.includes(x.i));
        items = [...items, ...more];
        log(`${label} retry: ${more.length}/${missing.length} recovered`);
      }
      missing = missingLines(chunk, items);
      if (missing.length) log(`${label}: lines ${missing.join(', ')} stay untranslated`);
    }
    replies.push(...items.filter((x) => chunk.lines.some((l) => l.i === x.i)));
  }
  progress(1, 1);
  step('ai', 'done', `${replies.length} of ${lines.length} lines translated in ${chunks.length} message(s)`);
  return { replies, aiTabId };
}

// ---- step 3 + 4 ------------------------------------------------------------------------------------

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function offerFiles(video: VideoFile, s: ExtSettings) {
  const base = video.id;
  const json = JSON.stringify(video, null, 2);
  const srt = toSrt(video.segments);
  const srtTr = toSrt(video.segments.map((x) => ({ ...x, text: x.translation || x.text })));
  $('#result').hidden = false;
  $('#dl-json').onclick = () => download(`${base}.json`, json, 'application/json');
  $('#dl-srt').onclick = () => download(`${base}.${video.language}.srt`, srt);
  $('#dl-srt-tr').onclick = () => download(`${base}.${video.translation_language}.srt`, srtTr);
  if (s.downloadFiles) {
    download(`${base}.json`, json, 'application/json');
    download(`${base}.${video.language}.srt`, srt);
  }
}

async function sendToApp(video: VideoFile, s: ExtSettings) {
  step('app', 'active', `Opening ${s.appUrl}…`);
  const tab = await chrome.tabs.create({ url: `${s.appUrl}/#/videos`, active: true });
  await waitForTabLoaded(tab.id!);
  const res = await sendToTab<AppDeliverResult>(tab.id!, { type: 'app:deliver', payload: video });
  if (!res.ok) throw new Error(res.error);
  step('app', 'done', `Saved as ${res.id}${res.warnings?.length ? ` · ${res.warnings.join('; ')}` : ''}`);
  await chrome.tabs.update(tab.id!, { active: true });
}

// ---- main -------------------------------------------------------------------------------------------

async function main() {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));
  await initSettingsForm(params.has('settings') || !tabId);
  if (!tabId) {
    $('#steps').hidden = true;
    $('#title').textContent = 'Settings';
    return;
  }
  const s = await loadSettings();
  $('#provider-name').textContent = PROVIDERS[s.provider].name;
  let current: Step = 'transcript';
  let aiTabId: number | undefined;
  try {
    const { meta, cues } = await readTranscript(tabId, s);
    const lines = mergeCues(cues);
    log(`merged into ${lines.length} subtitle lines`);

    current = 'ai';
    const t = await translate(lines, s, meta.title);
    aiTabId = t.aiTabId;

    current = 'build';
    step('build', 'active');
    const parsed = normalizeVideo(
      buildVideoFile(
        { videoId: meta.videoId, title: meta.title, channel: meta.channel, duration: meta.duration, language: s.sourceLang, translationLanguage: s.targetLang, level: s.level },
        lines,
        t.replies,
      ),
    );
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const video = parsed.video;
    await chrome.storage.local.set({ lastVideo: video });
    step('build', 'done', `${video.segments.length} lines${parsed.warnings.length ? ` · ${parsed.warnings.join('; ')}` : ''}`);
    offerFiles(video, s);
    if (s.closeAiTab && aiTabId !== undefined) await chrome.tabs.remove(aiTabId).catch(() => {});

    current = 'app';
    const deliverOnce = () =>
      sendToApp(video, s).catch((e) => {
        step('app', 'error', `${errorText(e)}\nIs the app running at ${s.appUrl}? You can change the address in Settings.`);
        $('#send-again').hidden = false;
      });
    $('#send-again').onclick = () => {
      $('#send-again').hidden = true;
      void deliverOnce();
    };
    await deliverOnce();
  } catch (e) {
    step(current, 'error', errorText(e));
    log(`stopped: ${errorText(e)}`);
  }
}

void main();
