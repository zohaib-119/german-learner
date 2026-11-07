/** Base URL of the local tts-service. Override with VITE_TTS_URL in `.env` (see `.env.example`). */
export const TTS_URL: string = ((import.meta.env?.VITE_TTS_URL as string | undefined) || 'http://localhost:8787').replace(/\/+$/, '');
