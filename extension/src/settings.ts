export type Provider = 'chatgpt' | 'claude';

export interface ExtSettings {
  provider: Provider;
  /** Optional: a specific chat/project URL to use instead of a new chat. */
  chatUrl: string;
  level: string;
  /** Spoken language of the videos (name for the prompt, code for caption tracks). */
  sourceLanguage: string;
  sourceLang: string;
  targetLanguage: string;
  targetLang: string;
  /** Where Deutsch Trainer runs. */
  appUrl: string;
  /** Subtitle lines sent per AI message. */
  chunkSize: number;
  closeAiTab: boolean;
  downloadFiles: boolean;
}

export const PROVIDERS: Record<Provider, { name: string; newChatUrl: string }> = {
  chatgpt: { name: 'ChatGPT', newChatUrl: 'https://chatgpt.com/?temporary-chat=true' },
  claude: { name: 'Claude', newChatUrl: 'https://claude.ai/new' },
};

export const DEFAULT_SETTINGS: ExtSettings = {
  provider: 'chatgpt',
  chatUrl: '',
  level: 'A2',
  sourceLanguage: 'German',
  sourceLang: 'de',
  targetLanguage: 'English',
  targetLang: 'en',
  appUrl: 'http://localhost:5173',
  chunkSize: 40,
  closeAiTab: true,
  downloadFiles: false,
};

const KEY = 'settings';

export function sanitize(raw: unknown): ExtSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ExtSettings, unknown>>;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const chunk = Number(r.chunkSize);
  return {
    provider: r.provider === 'claude' ? 'claude' : 'chatgpt',
    chatUrl: typeof r.chatUrl === 'string' ? r.chatUrl.trim() : '',
    level: ['A1', 'A2', 'B1', 'B2', 'C1'].includes(String(r.level)) ? String(r.level) : DEFAULT_SETTINGS.level,
    sourceLanguage: str(r.sourceLanguage, DEFAULT_SETTINGS.sourceLanguage),
    sourceLang: str(r.sourceLang, DEFAULT_SETTINGS.sourceLang),
    targetLanguage: str(r.targetLanguage, DEFAULT_SETTINGS.targetLanguage),
    targetLang: str(r.targetLang, DEFAULT_SETTINGS.targetLang),
    appUrl: str(r.appUrl, DEFAULT_SETTINGS.appUrl).replace(/\/+$/, ''),
    chunkSize: Number.isFinite(chunk) && chunk >= 2 && chunk <= 120 ? Math.round(chunk) : DEFAULT_SETTINGS.chunkSize,
    closeAiTab: typeof r.closeAiTab === 'boolean' ? r.closeAiTab : DEFAULT_SETTINGS.closeAiTab,
    downloadFiles: typeof r.downloadFiles === 'boolean' ? r.downloadFiles : DEFAULT_SETTINGS.downloadFiles,
  };
}

export async function loadSettings(): Promise<ExtSettings> {
  return sanitize((await chrome.storage.local.get(KEY))[KEY]);
}

export async function saveSettings(patch: Partial<ExtSettings>): Promise<ExtSettings> {
  const next = sanitize({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function chatUrlFor(s: ExtSettings): string {
  return s.chatUrl || PROVIDERS[s.provider].newChatUrl;
}
