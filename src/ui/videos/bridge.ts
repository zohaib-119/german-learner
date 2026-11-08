import { db, saveVideo } from '../../db';
import { normalizeVideo } from '../../core/video';

/**
 * Receives finished subtitles from the browser extension.
 *
 * The extension's content script runs on this page and forwards the data with `window.postMessage`.
 * Only same-window, same-origin messages with the expected envelope are accepted, and the payload is
 * validated with the same schema as a manually imported file.
 */
export const EXTENSION_SOURCE = 'deutsch-extension';
export const APP_SOURCE = 'deutsch-app';

export function installExtensionBridge(onImported: (id: string) => void): () => void {
  const handler = async (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: string; type?: string; requestId?: string; payload?: unknown } | null;
    if (!data || data.source !== EXTENSION_SOURCE || data.type !== 'video-import') return;
    const reply = (body: Record<string, unknown>) =>
      window.postMessage({ source: APP_SOURCE, type: 'video-import-result', requestId: data.requestId, ...body }, window.location.origin);
    const parsed = normalizeVideo(data.payload);
    if (!parsed.ok) {
      reply({ ok: false, errors: parsed.errors });
      return;
    }
    try {
      const row = await saveVideo(db, parsed.video);
      reply({ ok: true, id: row.id, warnings: parsed.warnings });
      onImported(row.id);
    } catch (e) {
      reply({ ok: false, errors: [e instanceof Error ? e.message : String(e)] });
    }
  };
  window.addEventListener('message', handler);
  // Tells an extension content script (if present) that the app is ready to receive.
  window.postMessage({ source: APP_SOURCE, type: 'ready' }, window.location.origin);
  return () => window.removeEventListener('message', handler);
}
