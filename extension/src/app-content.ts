// Content script for the Deutsch Trainer app (localhost). Forwards finished subtitles to the page,
// which validates and stores them (see src/ui/videos/bridge.ts in the app).
import type { AppDeliver, AppDeliverResult } from './messages';

const EXTENSION_SOURCE = 'deutsch-extension';
const APP_SOURCE = 'deutsch-app';

function deliver(payload: unknown): Promise<AppDeliverResult> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'The page did not answer. Is this the Deutsch Trainer app, and is it up to date?' });
    }, 15_000);
    function onMessage(e: MessageEvent) {
      const d = e.data as { source?: string; type?: string; requestId?: string; ok?: boolean; id?: string; errors?: string[]; warnings?: string[] } | null;
      if (e.source !== window || d?.source !== APP_SOURCE || d.type !== 'video-import-result' || d.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(d.ok && d.id ? { ok: true, id: d.id, warnings: d.warnings ?? [] } : { ok: false, error: (d.errors ?? ['The app rejected the subtitles.']).join('\n') });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: EXTENSION_SOURCE, type: 'video-import', requestId, payload }, window.location.origin);
  });
}

chrome.runtime.onMessage.addListener((msg: AppDeliver | { type: 'app:ping' }, _sender, sendResponse) => {
  if (msg?.type === 'app:ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'app:deliver') {
    void deliver(msg.payload).then(sendResponse);
    return true;
  }
  return false;
});
