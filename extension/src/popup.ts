import { videoIdFromUrl } from '../../src/core/video/subtitles';
import { getEntry } from './library';
import { LEVEL_NAMES, PROVIDERS, loadSettings, saveSettings, type Provider } from './settings';

const isVideo = (url = '') => /^https:\/\/(www|m)\.youtube\.com\/(watch\?|shorts\/)/.test(url);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function activeTab() {
  // ?tab=<id> lets the end-to-end test open this page for a specific tab
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const openJob = async (query: string) => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`job.html?${query}`) });
  window.close();
};

async function init() {
  let s = await loadSettings();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#provider button')];
  const paint = () => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.provider === s.provider)));
  paint();
  buttons.forEach((b) => (b.onclick = async () => {
    s = await saveSettings({ provider: b.dataset.provider as Provider });
    paint();
    describe();
  }));

  const tab = await activeTab();
  const go = $<HTMLButtonElement>('go');
  const open = $<HTMLButtonElement>('open');
  const hint = $('hint');
  const videoId = tab?.url && isVideo(tab.url) ? videoIdFromUrl(tab.url) : null;
  const entry = videoId ? await getEntry(videoId) : null;

  function describe() {
    if (!videoId || tab?.id === undefined) return;
    if (entry) {
      hint.className = 'ready';
      hint.textContent = `Subtitles ready · made ${new Date(entry.createdAt).toLocaleDateString()} with ${entry.provider}`;
    } else {
      hint.className = '';
      hint.textContent = `${LEVEL_NAMES[s.level] ?? s.level} · ${s.glossMode === 'all' ? 'every word explained' : 'harder words'} · ${PROVIDERS[s.provider].name}`;
    }
  }

  if (videoId && tab?.id !== undefined) {
    describe();
    go.disabled = false;
    const lesson = $<HTMLButtonElement>('lesson');
    lesson.disabled = false;
    lesson.onclick = () => openJob(`tab=${tab.id}&kind=lesson`);
    if (entry) {
      open.hidden = false;
      open.onclick = () => openJob(`tab=${tab.id}&video=${videoId}&mode=open`);
      go.textContent = 'Create again';
      go.className = 'secondary';
      go.onclick = () => openJob(`tab=${tab.id}&mode=new`);
    } else {
      go.onclick = () => openJob(`tab=${tab.id}`);
    }
  }
  $('settings').onclick = () => openJob('settings');
}

void init();
