/** What the scraper returns to the job page. */
export interface ScrapedVideo {
  ok: boolean;
  meta: {
    videoId: string;
    title: string;
    channel?: string | undefined;
    duration?: number | undefined;
    tracks: { lang: string; kind: string; name?: string | undefined }[];
  };
  /** How the transcript was obtained. */
  method?: 'panel' | 'caption-track';
  /** Language label shown in YouTube's transcript panel, when known. */
  language?: string | undefined;
  cues: { start: number; end?: number; text: string }[];
  error?: string;
  log: string[];
}

/**
 * Runs inside the YouTube watch page (MAIN world, via chrome.scripting.executeScript).
 * IMPORTANT: this function is serialised and injected on its own, so it must not use anything
 * from outside its body (no imports, no helpers defined elsewhere).
 *
 * Order of attempts:
 *  1. YouTube's own "Show transcript" panel (what you would open by hand) — read from the page.
 *  2. The caption track listed in the player response (works for some videos only).
 */
export async function scrapeYouTube(preferredLang: string): Promise<ScrapedVideo> {
  const log: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const toSec = (ts: string) => ts.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  const isTime = (s: string) => /^\d{1,2}(?::\d{2}){1,2}$/.test(s.trim());

  const url = new URL(location.href);
  const videoId = url.searchParams.get('v') ?? location.pathname.match(/\/(?:shorts|live)\/([\w-]{11})/)?.[1] ?? '';

  // ---- metadata: the player's live response is correct even after in-app navigation
  type PlayerResponse = {
    videoDetails?: { videoId?: string; title?: string; author?: string; lengthSeconds?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string; runs?: { text: string }[] } }[] } };
  };
  let pr: PlayerResponse | null = null;
  try {
    const mp = document.querySelector('#movie_player') as unknown as { getPlayerResponse?: () => PlayerResponse } | null;
    pr = mp?.getPlayerResponse?.() ?? null;
  } catch {
    /* ignore */
  }
  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  if ((!pr || pr.videoDetails?.videoId !== videoId) && initial?.videoDetails?.videoId === videoId) pr = initial;
  const details = pr?.videoDetails ?? {};
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const meta: ScrapedVideo['meta'] = {
    videoId,
    title: details.title || document.title.replace(/\s*-\s*YouTube\s*$/, ''),
    channel: details.author,
    duration: Number(details.lengthSeconds) || undefined,
    tracks: tracks.map((t) => ({ lang: t.languageCode, kind: t.kind || 'manual', name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text).join('') })),
  };
  if (!videoId) return { ok: false, meta, cues: [], error: 'This tab is not a YouTube video page.', log };
  log.push(`video ${videoId}: "${meta.title}"; caption tracks: ${meta.tracks.map((t) => `${t.lang}/${t.kind}`).join(', ') || 'none'}`);

  // ---- 1. transcript panel
  const readPanel = () => {
    const out: { start: number; text: string }[] = [];
    const rows = document.querySelectorAll('ytd-transcript-segment-renderer');
    rows.forEach((row) => {
      const ts = row.querySelector('.segment-timestamp')?.textContent?.trim() ?? '';
      const text = row.querySelector('.segment-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (isTime(ts) && text) out.push({ start: toSec(ts), text });
    });
    if (out.length) return out;
    // Fallback for other markup: any element in the transcript panel whose text is a timestamp.
    const panel = document.querySelector('[target-id*="transcript"]');
    if (!panel) return out;
    panel.querySelectorAll('*').forEach((el) => {
      if (el.children.length || !isTime(el.textContent ?? '')) return;
      const row = el.closest('[role="button"], ytd-transcript-segment-renderer, transcript-segment-view-model') ?? el.parentElement?.parentElement;
      const text = (row?.textContent ?? '').replace(el.textContent ?? '', '').replace(/\s+/g, ' ').trim();
      if (text) out.push({ start: toSec(el.textContent!.trim()), text });
    });
    return out;
  };

  let rows = readPanel();
  if (!rows.length) {
    const findButton = () =>
      (document.querySelector('ytd-video-description-transcript-section-renderer button') as HTMLElement | null) ??
      ([...document.querySelectorAll('button, [role="button"]')].find((b) => /transcript/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`)) as HTMLElement | undefined) ??
      null;
    let button = findButton();
    if (!button) {
      const expand = document.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand, tp-yt-paper-button#expand') as HTMLElement | null;
      expand?.click();
      await sleep(700);
      button = findButton();
    }
    if (button) {
      log.push(`clicking "${(button.getAttribute('aria-label') || button.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)}" <${button.tagName.toLowerCase()}>`);
      button.click();
      log.push('opened YouTube’s transcript panel');
    } else {
      log.push('no "Show transcript" button on this page');
    }
    // Some layouts keep the panel collapsed: ask it to expand directly.
    const panelEl = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');
    if (panelEl && panelEl.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
      panelEl.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      log.push('expanded the transcript panel');
    }
    for (let i = 0; i < 80 && !(rows = readPanel()).length; i++) await sleep(250);
    if (rows.length) await sleep(400); // let the panel finish rendering
    rows = readPanel();
    if (!rows.length) {
      // Diagnostics: what does the panel contain? (helps adapt the selectors when YouTube changes)
      const panels = [...document.querySelectorAll('ytd-engagement-panel-section-list-renderer')].map((p) => p.getAttribute('target-id') || '?');
      log.push(`engagement panels on page: ${panels.join(', ') || 'none'}`);
      const t = document.querySelector('[target-id*="transcript"]');
      if (t) {
        log.push(`transcript panel visibility=${t.getAttribute('visibility')}; text: ${(t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`);
        log.push(`transcript panel html: ${t.innerHTML.replace(/\s+/g, ' ').slice(0, 1500)}`);
      }
    }
  }
  if (rows.length) {
    const language = document.querySelector('ytd-transcript-footer-renderer yt-dropdown-menu, ytd-transcript-footer-renderer')?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    log.push(`read ${rows.length} transcript segments from the panel${language ? ` (${language})` : ''}`);
    return { ok: true, meta, method: 'panel', language, cues: rows, log };
  }

  // ---- 2. caption track
  const wanted = [...tracks].sort((a, b) => {
    const score = (t: (typeof tracks)[number]) => (t.languageCode.startsWith(preferredLang) ? 2 : 0) + (t.kind === 'asr' ? 0 : 1);
    return score(b) - score(a);
  });
  for (const t of wanted) {
    try {
      const r = await fetch(`${t.baseUrl}&fmt=json3`, { credentials: 'include' });
      const body = await r.text();
      if (!body.trim()) {
        log.push(`caption track ${t.languageCode} returned an empty response`);
        continue;
      }
      const data = JSON.parse(body) as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };
      const cues = (data.events ?? [])
        .filter((e) => e.segs?.length)
        .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, end: ((e.tStartMs ?? 0) + (e.dDurationMs ?? 0)) / 1000, text: (e.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
      if (cues.length) {
        log.push(`read ${cues.length} cues from caption track ${t.languageCode}/${t.kind || 'manual'}`);
        return { ok: true, meta, method: 'caption-track', language: t.languageCode, cues, log };
      }
    } catch (e) {
      log.push(`caption track ${t.languageCode} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    ok: false,
    meta,
    cues: [],
    error: tracks.length ? 'Could not read the transcript automatically.' : 'This video has no captions or transcript.',
    log,
  };
}
