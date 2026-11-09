/** Messages between the job page and the content scripts. */
export type AiAsk = { type: 'ai:ask'; prompt: string; timeoutMs?: number };
export type AiPing = { type: 'ai:ping' };
/** `video`: subtitle file (object). `lesson`: lesson file text (docs/LESSON_FORMAT.md). */
export type DeliverKind = 'video' | 'lesson';
export type AppDeliver = { type: 'app:deliver'; payload: unknown; kind?: DeliverKind };
export type AppPing = { type: 'app:ping' };

export type AiAskResult = { ok: true; text: string; via: 'code-block' | 'message' } | { ok: false; error: string };
export type AppDeliverResult = { ok: true; id: string; warnings?: string[] } | { ok: false; error: string };
