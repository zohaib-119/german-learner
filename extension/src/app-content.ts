// Content script for the German Learner app (localhost). Forwards finished subtitles or a lesson to
// the page, which validates and stores them (see src/ui/videos/bridge.ts in the app).
import type { AppDeliver, AppDeliverResult, DeliverKind } from './messages';

const EXTENSION_SOURCE = 'deutsch-extension';
const APP_SOURCE = 'deutsch-app';

function deliver(payload: unknown, kind: DeliverKind): Promise<AppDeliverResult> {
  const type = kind === 'lesson' ? 'lesson-import' : 'video-import';
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'The page did not answer. Is this the German Learner app, and is it up to date?' });
    }, 15_000);
    function onMessage(e: MessageEvent) {
      const d = e.data as { source?: string; type?: string; requestId?: string; ok?: boolean; id?: string; errors?: string[]; warnings?: string[] } | null;
      if (e.source !== window || d?.source !== APP_SOURCE || d.type !== `${type}-result` || d.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(d.ok && d.id ? { ok: true, id: d.id, warnings: d.warnings ?? [] } : { ok: false, error: (d.errors ?? [`The app rejected the ${kind === 'lesson' ? 'lesson' : 'subtitles'}.`]).join('\n') });
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: EXTENSION_SOURCE, type, requestId, payload }, window.location.origin);
  });
}

chrome.runtime.onMessage.addListener((msg: AppDeliver | { type: 'app:ping' }, _sender, sendResponse) => {
  if (msg?.type === 'app:ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'app:deliver') {
    void deliver(msg.payload, msg.kind ?? 'video').then(sendResponse);
    return true;
  }
  return false;
});
