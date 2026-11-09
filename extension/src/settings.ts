export type Provider = 'chatgpt' | 'claude';

export interface ExtSettings {
  provider: Provider;
  /** Optional: a specific chat/project URL to use instead of a new chat. */
  chatUrl: string;
  level: string;
  /** "all": explain every word every time (complete beginners). "hard": only harder words. */
  glossMode: 'all' | 'hard';
  /** Spoken language of the videos (name for the prompt, code for caption tracks). */
  sourceLanguage: string;
  sourceLang: string;
  targetLanguage: string;
  targetLang: string;
  /** Where the German Learner app runs. */
  appUrl: string;
  /** Subtitle lines sent per AI message. */
  chunkSize: number;
  closeAiTab: boolean;
  downloadFiles: boolean;
  /** Bumped when defaults change in a way that should update saved settings once. */
  version: number;
}

export const PROVIDERS: Record<Provider, { name: string; newChatUrl: string }> = {
  chatgpt: { name: 'ChatGPT', newChatUrl: 'https://chatgpt.com/?temporary-chat=true' },
  claude: { name: 'Claude', newChatUrl: 'https://claude.ai/new' },
};

export const DEFAULT_SETTINGS: ExtSettings = {
  provider: 'chatgpt',
  chatUrl: '',
  level: 'A0',
  glossMode: 'all',
  sourceLanguage: 'German',
  sourceLang: 'de',
  targetLanguage: 'English',
  targetLang: 'en',
  appUrl: 'http://localhost:5173',
  chunkSize: 15,
  closeAiTab: true,
  downloadFiles: false,
  version: 2,
};

export const LEVEL_NAMES: Record<string, string> = { A0: 'Complete beginner', A1: 'A1', A2: 'A2', B1: 'B1', B2: 'B2', C1: 'C1' };

const KEY = 'settings';

export function sanitize(raw: unknown): ExtSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ExtSettings, unknown>>;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const chunk = Number(r.chunkSize);
  // v2: beginner focus. Older saved settings move to the new defaults once.
  if (Number(r.version ?? 1) < 2) {
    r.level = DEFAULT_SETTINGS.level;
    r.glossMode = DEFAULT_SETTINGS.glossMode;
    r.chunkSize = DEFAULT_SETTINGS.chunkSize;
    r.version = 2;
    return sanitize(r);
  }
  return {
    provider: r.provider === 'claude' ? 'claude' : 'chatgpt',
    chatUrl: typeof r.chatUrl === 'string' ? r.chatUrl.trim() : '',
    level: String(r.level) in LEVEL_NAMES ? String(r.level) : DEFAULT_SETTINGS.level,
    glossMode: r.glossMode === 'hard' ? 'hard' : 'all',
    sourceLanguage: str(r.sourceLanguage, DEFAULT_SETTINGS.sourceLanguage),
    sourceLang: str(r.sourceLang, DEFAULT_SETTINGS.sourceLang),
    targetLanguage: str(r.targetLanguage, DEFAULT_SETTINGS.targetLanguage),
    targetLang: str(r.targetLang, DEFAULT_SETTINGS.targetLang),
    appUrl: str(r.appUrl, DEFAULT_SETTINGS.appUrl).replace(/\/+$/, ''),
    chunkSize: Number.isFinite(chunk) && chunk >= 2 && chunk <= 120 ? Math.round(chunk) : DEFAULT_SETTINGS.chunkSize,
    closeAiTab: typeof r.closeAiTab === 'boolean' ? r.closeAiTab : DEFAULT_SETTINGS.closeAiTab,
    downloadFiles: typeof r.downloadFiles === 'boolean' ? r.downloadFiles : DEFAULT_SETTINGS.downloadFiles,
    version: 2,
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
