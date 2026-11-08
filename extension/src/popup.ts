import { PROVIDERS, loadSettings } from './settings';

const isVideo = (url = '') => /^https:\/\/(www|m)\.youtube\.com\/(watch\?|shorts\/)/.test(url);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await loadSettings();
  const go = document.getElementById('go') as HTMLButtonElement;
  const hint = document.getElementById('hint')!;
  if (tab?.id !== undefined && isVideo(tab.url)) {
    go.disabled = false;
    hint.textContent = `${s.level} · translated into ${s.targetLanguage} with ${PROVIDERS[s.provider].name}`;
    go.onclick = async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`job.html?tab=${tab.id}`) });
      window.close();
    };
  }
  document.getElementById('settings')!.onclick = async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('job.html?settings') });
    window.close();
  };
}

void init();
