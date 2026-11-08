// Content script for AI chat sites (ChatGPT, Claude). Receives a prompt from the job page,
// writes it into the chat box, sends it, waits for the reply to finish and returns its text.
import type { AiAsk, AiAskResult } from './messages';

interface Profile {
  name: string;
  composer: string[];
  send: string[];
  stop: string[];
  assistant: string[];
}

const GENERIC: Profile = {
  name: 'AI chat',
  composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
  send: ['[data-testid="send-button"]', 'button[aria-label="Send message"]', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
  stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
  assistant: ['[data-message-author-role="assistant"]', '.font-claude-response', '.font-claude-message', '[data-testid="assistant-message"]'],
};

const PROFILES: { hosts: RegExp; profile: Profile }[] = [
  {
    hosts: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
    profile: {
      name: 'ChatGPT',
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[data-testid="prompt-textarea"]'],
      send: ['[data-testid="send-button"]', 'button[aria-label*="Send" i]'],
      stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
      assistant: ['[data-message-author-role="assistant"]'],
    },
  },
  {
    hosts: /(^|\.)claude\.ai$/,
    profile: {
      name: 'Claude',
      composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
      stop: ['button[aria-label="Stop response"]', 'button[aria-label*="Stop" i]'],
      assistant: ['.font-claude-response', '.font-claude-message', '[data-is-streaming]'],
    },
  },
];

const host = location.hostname;
const site = PROFILES.find((p) => p.hosts.test(host))?.profile ?? GENERIC;
const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const S = {
  composer: merge(site.composer, GENERIC.composer),
  send: merge(site.send, GENERIC.send),
  stop: merge(site.stop, GENERIC.stop),
  assistant: merge(site.assistant, GENERIC.assistant),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (el: Element | null): el is HTMLElement => !!el && el.isConnected && (el as HTMLElement).getBoundingClientRect().width > 0;
const first = (selectors: string[]) => {
  for (const s of selectors) {
    try {
      const found = [...document.querySelectorAll(s)].find(visible);
      if (found) return found as HTMLElement;
    } catch {
      /* invalid selector on this browser */
    }
  }
  return null;
};
const all = (selectors: string[]) => {
  const out = new Set<Element>();
  for (const s of selectors) {
    try {
      document.querySelectorAll(s).forEach((e) => out.add(e));
    } catch {
      /* ignore */
    }
  }
  return [...out];
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs: number, label: string): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label} on ${site.name}.`);
}

function composerText(el: HTMLElement): string {
  return norm(el instanceof HTMLTextAreaElement ? el.value : el.innerText || el.textContent || '');
}

/** Puts text into the chat box. Tries the most editor-friendly method first. */
async function writePrompt(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  const probe = norm(text).slice(0, 40);
  const landed = () => composerText(el).includes(probe) || isSendReady();

  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    if (landed()) return;
  } else {
    // 1. A paste event: rich editors (ProseMirror) handle it like a real paste, keeping line breaks.
    document.execCommand('selectAll');
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await sleep(500);
    if (landed()) return;
    // 2. insertText command.
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    await sleep(500);
    if (landed()) return;
    // 3. Last resort: set the content directly.
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await sleep(500);
    if (landed()) return;
  }
  throw new Error(`${site.name} did not accept the text in its chat box.`);
}

function isSendReady(): HTMLButtonElement | null {
  const b = first(S.send) as HTMLButtonElement | null;
  return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
}

function codeBlocks(): HTMLElement[] {
  return [...document.querySelectorAll('pre')].map((pre) => (pre.querySelector('code') as HTMLElement | null) ?? pre);
}

function lastAssistantText(): string {
  const nodes = all(S.assistant);
  const last = nodes[nodes.length - 1] as HTMLElement | undefined;
  return last ? (last.innerText || last.textContent || '').trim() : '';
}

/**
 * Sends the prompt and waits for the answer. The answer is complete when the stop button is gone and
 * the text has not changed for a few seconds. A new code block (we ask for JSON in one) is preferred;
 * otherwise the last assistant message is returned.
 */
async function ask(prompt: string, timeoutMs: number): Promise<AiAskResult> {
  const composer = await waitFor(() => first(S.composer), 45_000, 'the chat box');
  await sleep(600); // let the page settle after load
  const blocksBefore = new Set(codeBlocks());
  const textsBefore = new Set(codeBlocks().map((b) => b.textContent ?? ''));
  const assistantBefore = all(S.assistant).length;

  await writePrompt(composer, prompt);
  const send = await waitFor(isSendReady, 20_000, 'the send button');
  send.click();

  const started = Date.now();
  let last = '';
  let stableSince = 0;
  let sawActivity = false;
  while (Date.now() - started < timeoutMs) {
    await sleep(500);
    // new elements whose text we have not seen before (re-rendered old answers are ignored)
    const newBlocks = codeBlocks().filter((b) => !blocksBefore.has(b) && !textsBefore.has(b.textContent ?? ''));
    const block = newBlocks[newBlocks.length - 1];
    const assistantNow = all(S.assistant).length;
    const text = block ? (block.textContent ?? '') : assistantNow > assistantBefore ? lastAssistantText() : '';
    const streaming = !!first(S.stop);
    if (text || streaming) sawActivity = true;
    if (text && text === last) stableSince ||= Date.now();
    else stableSince = 0;
    last = text;
    const quietFor = stableSince ? Date.now() - stableSince : 0;
    // a JSON block that does not end in ] or } is probably still being written; give it longer
    const looksUnfinished = !!block && !/[\]}]\s*$/.test(text) && quietFor < 10_000;
    if (text && !streaming && quietFor >= 2500 && !looksUnfinished) {
      return { ok: true, text, via: block ? 'code-block' : 'message' };
    }
    if (!sawActivity && Date.now() - started > 60_000) break;
  }
  return { ok: false, error: sawActivity ? `${site.name} took too long to answer.` : `${site.name} did not start answering. Are you logged in?` };
}

chrome.runtime.onMessage.addListener((msg: AiAsk | { type: 'ai:ping' }, _sender, sendResponse) => {
  if (msg?.type === 'ai:ping') {
    sendResponse({ ok: true, site: site.name, ready: !!first(S.composer) });
    return false;
  }
  if (msg?.type === 'ai:ask') {
    ask(msg.prompt, msg.timeoutMs ?? 6 * 60_000)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies AiAskResult));
    return true; // keep the channel open for the async answer
  }
  return false;
});
