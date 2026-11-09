// The job page: runs one pipeline for a YouTube tab and shows its progress. Two independent jobs:
//   subtitles (default): transcript -> AI chat (chunk by chunk) -> validated subtitle file -> Videos
//   lesson (?kind=lesson): transcript + LESSON_FORMAT.md -> AI chat -> validated lesson file -> Lessons
import lessonGuide from '../../LESSON_FORMAT.md';
import { buildLessonFixPrompt, buildLessonPrompt, parseLessonReply, type LessonReply } from '../../src/core/lesson-ai';
import { buildVideoFile } from '../../src/core/video/build';
import { mergeCues, type Line } from '../../src/core/video/lines';
import { buildPrompt, buildRetryPrompt, chunkLines, missingLines, parseAiReply, type AiItem } from '../../src/core/video/prompt';
import { normalizeVideo, type VideoFile } from '../../src/core/video/schema';
import { parseTranscriptText, toSrt, videoIdFromUrl, type Cue } from '../../src/core/video/subtitles';
import type { AiAskResult, AppDeliverResult, DeliverKind } from './messages';
import { getEntry, putEntry } from './library';
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

let jobLabel = 'Subtitles';
function showVideo(meta: ScrapedVideo['meta']) {
  $('#title').textContent = meta.title;
  $('#subtitle').textContent = [meta.channel, meta.duration ? `${Math.round(meta.duration / 60)} min` : ''].filter(Boolean).join(' · ');
  const img = $<HTMLImageElement>('#thumb');
  img.src = `https://i.ytimg.com/vi/${meta.videoId}/mqdefault.jpg`;
  img.hidden = false;
  document.title = `${jobLabel} · ${meta.title}`;
}

// ---- step 2: AI --------------------------------------------------------------------------------------

async function openAiTab(s: ExtSettings): Promise<number> {
  step('ai', 'active', `Opening ${PROVIDERS[s.provider].name}…`);
  const tab = await chrome.tabs.create({ url: chatUrlFor(s), active: true });
  const aiTabId = tab.id!;
  await waitForTabLoaded(aiTabId);
  const ping = await sendToTab<{ ok: boolean; site: string }>(aiTabId, { type: 'ai:ping' });
  log(`connected to ${ping.site} (${chatUrlFor(s)})`);
  return aiTabId;
}

async function translate(lines: Line[], s: ExtSettings, title: string): Promise<{ replies: AiItem[]; aiTabId: number }> {
  const chunks = chunkLines(lines, { maxLines: s.chunkSize });
  const options = { level: s.level, glossMode: s.glossMode, sourceLanguage: s.sourceLanguage, targetLanguage: s.targetLanguage, title };
  const aiTabId = await openAiTab(s);

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

/** Lesson job: one prompt with the whole transcript and the format guide, plus one round of fixes. */
async function writeLesson(lines: Line[], s: ExtSettings, meta: ScrapedVideo['meta']): Promise<{ reply: LessonReply & { ok: true }; aiTabId: number }> {
  const provider = PROVIDERS[s.provider].name;
  const aiTabId = await openAiTab(s);
  const ask = async (prompt: string) => {
    const res = await sendToTab<AiAskResult>(aiTabId, { type: 'ai:ask', prompt, timeoutMs: 10 * 60_000 }, 3);
    if (!res.ok) throw new Error(res.error);
    return parseLessonReply(res.text, { videoId: meta.videoId, title: meta.title });
  };
  const prompt = buildLessonPrompt({
    guide: lessonGuide,
    transcript: lines.map((l) => l.text).join('\n'),
    videoId: meta.videoId,
    title: meta.title,
    channel: meta.channel,
    level: s.level,
    sourceLanguage: s.sourceLanguage,
    targetLanguage: s.targetLanguage,
  });
  step('ai', 'active', `${provider} is writing the lesson from ${lines.length} transcript lines…`);
  progress(0, 2);
  let reply = await ask(prompt);
  const problems = reply.ok ? (reply.missingWords ?? []) : reply.errors;
  log(reply.ok ? `lesson received: ${reply.lesson.items.length} words, ${reply.lesson.exercises.length} exercises` : `lesson has problems: ${problems.join(' | ')}`);
  if (problems.length) {
    step('ai', 'active', `Asking ${provider} to fix ${reply.ok ? 'missing words' : `${problems.length} problem(s)`}…`);
    progress(1, 2);
    const fixed = await ask(buildLessonFixPrompt(problems)).catch((e: unknown) => ({ ok: false as const, errors: [errorText(e)] }));
    log(fixed.ok ? `fixed lesson: ${fixed.lesson.items.length} words, ${fixed.lesson.exercises.length} exercises` : `fix failed: ${fixed.errors.join(' | ')}`);
    if (fixed.ok) reply = fixed;
  }
  if (!reply.ok) throw new Error(`The lesson from ${provider} is not valid:\n${reply.errors.join('\n')}`);
  progress(1, 1);
  step('ai', 'done', `${reply.lesson.items.length} words and phrases · ${reply.lesson.exercises.length} exercises`);
  return { reply, aiTabId };
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

async function sendToApp(payload: unknown, kind: DeliverKind, s: ExtSettings) {
  step('app', 'active', `Opening ${s.appUrl}…`);
  const tab = await chrome.tabs.create({ url: `${s.appUrl}/#/${kind === 'lesson' ? 'lessons' : 'videos'}`, active: true });
  await waitForTabLoaded(tab.id!);
  const res = await sendToTab<AppDeliverResult>(tab.id!, { type: 'app:deliver', payload, kind });
  if (!res.ok) throw new Error(res.error);
  step('app', 'done', `Saved as ${res.id}${res.warnings?.length ? ` · ${res.warnings.join('; ')}` : ''}`);
  await chrome.tabs.update(tab.id!, { active: true });
}

function setLessonLabels(provider: string) {
  const label = (st: Step, text: string) => (($(`[data-step="${st}"] b`) as HTMLElement).textContent = text);
  label('ai', `Write the lesson with ${provider}`);
  label('build', 'Check the lesson');
  jobLabel = 'Lesson';
  document.title = 'Lesson from video';
  $('#heading-kind').textContent = 'Lesson from this video';
}

function offerLessonFile(id: string, text: string, s: ExtSettings) {
  $('#result').hidden = false;
  for (const b of ['#dl-json', '#dl-srt', '#dl-srt-tr']) $(b).hidden = true;
  $('#dl-lesson').hidden = false;
  $('#dl-lesson').onclick = () => download(`${id}.json`, text, 'application/json');
  $('#result-note').textContent = 'If the app did not open, import this file on its Lessons page.';
  if (s.downloadFiles) download(`${id}.json`, text, 'application/json');
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
  const kind: DeliverKind = params.get('kind') === 'lesson' ? 'lesson' : 'video';
  $('#provider-name').textContent = PROVIDERS[s.provider].name;
  let current: Step = 'transcript';
  let aiTabId: number | undefined;

  const deliver = async (payload: unknown) => {
    current = 'app';
    const deliverOnce = () =>
      sendToApp(payload, kind, s).catch((e) => {
        step('app', 'error', `${errorText(e)}\nIs the app running at ${s.appUrl}? You can change the address in Settings.`);
        $('#send-again').hidden = false;
      });
    $('#send-again').onclick = () => {
      $('#send-again').hidden = true;
      void deliverOnce();
    };
    await deliverOnce();
  };

  if (kind === 'lesson') {
    setLessonLabels(PROVIDERS[s.provider].name);
    try {
      const { meta, cues } = await readTranscript(tabId, s);
      const lines = mergeCues(cues);
      log(`merged into ${lines.length} transcript lines`);
      current = 'ai';
      const w = await writeLesson(lines, s, meta);
      aiTabId = w.aiTabId;
      current = 'build';
      const { lesson, warnings } = w.reply;
      step('build', 'done', `"${lesson.title}" · id ${lesson.id}${warnings.length ? ` · ${warnings.join('; ')}` : ''}`);
      offerLessonFile(lesson.id, w.reply.text!, s);
      if (s.closeAiTab && aiTabId !== undefined) await chrome.tabs.remove(aiTabId).catch(() => {});
      await deliver(w.reply.text);
    } catch (e) {
      step(current, 'error', errorText(e));
      log(`stopped: ${errorText(e)}`);
    }
    return;
  }

  try {
    // Already made for this video? Then skip straight to the app (unless "Create again" was chosen).
    const tabUrl = params.get('video') ?? (await chrome.tabs.get(tabId).catch(() => null))?.url ?? '';
    const knownId = videoIdFromUrl(tabUrl);
    const existing = knownId && params.get('mode') !== 'new' ? await getEntry(knownId) : null;
    if (existing) {
      showVideo({ videoId: knownId!, title: existing.video.title, channel: existing.video.channel, duration: existing.video.duration, tracks: [] });
      const when = new Date(existing.createdAt).toLocaleString();
      for (const st of ['transcript', 'ai', 'build'] as Step[]) step(st, 'done', st === 'build' ? `Saved earlier (${when}, ${existing.provider}) · ${existing.video.segments.length} lines` : 'Already done earlier');
      log(`using saved subtitles from ${when}; choose "Create again" in the popup to redo them`);
      offerFiles(existing.video, s);
      await deliver(existing.video);
      return;
    }

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
    await putEntry(video, PROVIDERS[s.provider].name);
    step('build', 'done', `${video.segments.length} lines${parsed.warnings.length ? ` · ${parsed.warnings.join('; ')}` : ''} · saved`);
    offerFiles(video, s);
    if (s.closeAiTab && aiTabId !== undefined) await chrome.tabs.remove(aiTabId).catch(() => {});
    await deliver(video);
  } catch (e) {
    step(current, 'error', errorText(e));
    log(`stopped: ${errorText(e)}`);
  }
}

void main();
