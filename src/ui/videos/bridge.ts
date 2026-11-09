import { getAudioSettings, makeEngine } from '../../audio/settings';
import { lessonTexts } from '../../audio/texts';
import { importLessonText } from '../../core/importer';
import { normalizeVideo } from '../../core/video';
import { db, saveLesson, saveVideo } from '../../db';

/**
 * Receives finished work from the browser extension: video subtitles (`video-import`) or a lesson
 * made from a video's transcript (`lesson-import`, a lesson file as text).
 *
 * The extension's content script runs on this page and forwards the data with `window.postMessage`.
 * Only same-window, same-origin messages with the expected envelope are accepted, and the payload is
 * validated exactly like a manually imported file.
 */
export const EXTENSION_SOURCE = 'deutsch-extension';
export const APP_SOURCE = 'deutsch-app';

export type Imported = { kind: 'video' | 'lesson'; id: string };
type Outcome = { ok: true; id: string; warnings: string[] } | { ok: false; errors: string[] };

async function importVideo(payload: unknown): Promise<Outcome> {
  const parsed = normalizeVideo(payload);
  if (!parsed.ok) return parsed;
  const row = await saveVideo(db, parsed.video);
  return { ok: true, id: row.id, warnings: parsed.warnings };
}

async function importLesson(payload: unknown): Promise<Outcome> {
  const text = typeof payload === 'string' ? payload : (payload as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') return { ok: false, errors: ['No lesson text received.'] };
  const parsed = importLessonText(text, 'lesson.json');
  if (!parsed.ok) return parsed;
  await saveLesson(db, parsed.lesson);
  // Prepare the audio in the background, like the Import page does; a missing voice service is fine.
  void getAudioSettings()
    .then((s) => makeEngine(s.engine, s).prepare?.(lessonTexts(parsed.lesson), () => {}))
    .catch(() => {});
  return { ok: true, id: parsed.lesson.id, warnings: parsed.warnings };
}

export function installExtensionBridge(onImported: (what: Imported) => void): () => void {
  const handler = async (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: string; type?: string; requestId?: string; payload?: unknown } | null;
    if (!data || data.source !== EXTENSION_SOURCE) return;
    const kind = data.type === 'video-import' ? 'video' : data.type === 'lesson-import' ? 'lesson' : null;
    if (!kind) return;
    const reply = (body: Record<string, unknown>) =>
      window.postMessage({ source: APP_SOURCE, type: `${data.type}-result`, requestId: data.requestId, ...body }, window.location.origin);
    try {
      const out = kind === 'video' ? await importVideo(data.payload) : await importLesson(data.payload);
      reply(out);
      if (out.ok) onImported({ kind, id: out.id });
    } catch (e) {
      reply({ ok: false, errors: [e instanceof Error ? e.message : String(e)] });
    }
  };
  window.addEventListener('message', handler);
  // Tells an extension content script (if present) that the app is ready to receive.
  window.postMessage({ source: APP_SOURCE, type: 'ready' }, window.location.origin);
  return () => window.removeEventListener('message', handler);
}
