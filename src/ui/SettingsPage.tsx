import { useEffect, useState } from 'react';
import type { EngineId } from '../audio/engine';
import { fetchHealth, type ServiceHealth } from '../audio/service';
import { DEFAULT_AUDIO_SETTINGS, getAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/settings';
import { germanVoices } from '../audio/webspeech';
import { SpeakButton } from './SpeakButton';

const SAMPLE = 'Ich hätte gern ein Brötchen, bitte.';

export function SettingsPage() {
  const [s, setS] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [health, setHealth] = useState<ServiceHealth | null | 'loading'>('loading');
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[] | null>(null);

  useEffect(() => {
    void getAudioSettings().then(setS);
    void germanVoices().then(setWebVoices);
  }, []);

  useEffect(() => {
    setHealth('loading');
    let live = true;
    void fetchHealth(s.serviceUrl).then((h) => live && setHealth(h));
    return () => {
      live = false;
    };
  }, [s.serviceUrl]);

  async function update(patch: Partial<AudioSettings>) {
    setS(await saveAudioSettings(patch));
  }

  const up = health !== 'loading' && health !== null;
  const engines: { id: EngineId; title: string; status: string; ok: boolean | null; note: string }[] = [
    {
      id: 'webspeech',
      title: 'Browser voice (Web Speech)',
      ok: webVoices === null ? null : webVoices.length > 0,
      status: webVoices === null ? 'checking…' : webVoices.length ? `${webVoices.length} German voice(s): ${webVoices[0]!.name}` : 'no German voice found',
      note: 'No setup. Best in Edge on Windows ("Natural" voices). Often poor or missing on Linux.',
    },
    {
      id: 'piper',
      title: 'Piper (local service, offline)',
      ok: health === 'loading' ? null : up && health.engines.piper.available,
      status: health === 'loading' ? 'checking…' : up ? (health.engines.piper.available ? 'ready' : 'service up, no voice installed') : 'service not running',
      note: 'Consistent and offline. Needs tts-service running (see tts-service/README.md).',
    },
    {
      id: 'edge',
      title: 'Edge neural (via service, online)',
      ok: health === 'loading' ? null : up && health.engines.edge.available,
      status: health === 'loading' ? 'checking…' : up ? (health.engines.edge.available ? 'ready (needs internet)' : 'edge-tts not installed') : 'service not running',
      note: 'Most natural free voices on Linux. Unofficial API; may break. Needs internet.',
    },
  ];

  return (
    <section>
      <h2>Audio engine</h2>
      {engines.map((e) => (
        <label key={e.id} className="card engine">
          <input type="radio" name="engine" checked={s.engine === e.id} onChange={() => void update({ engine: e.id })} />{' '}
          <strong>{e.title}</strong> <span className={e.ok === null ? 'meta' : e.ok ? 'ok' : 'err'}>— {e.status}</span>
          <div className="meta">{e.note}</div>
        </label>
      ))}
      <p className="meta">If the selected engine fails, the app falls back to the browser voice.</p>

      <h3>Voices</h3>
      <p>
        <label>
          Piper voice{' '}
          <select value={s.piperVoice} onChange={(e) => void update({ piperVoice: e.target.value })}>
            {(up && health.engines.piper.voices.length ? health.engines.piper.voices : [s.piperVoice]).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Edge voice{' '}
          <select value={s.edgeVoice} onChange={(e) => void update({ edgeVoice: e.target.value })}>
            {(up ? health.engines.edge.voices : [s.edgeVoice]).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Browser voice{' '}
          <select value={s.webVoiceURI} onChange={(e) => void update({ webVoiceURI: e.target.value })}>
            <option value="">(best available)</option>
            {(webVoices ?? []).map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Service URL{' '}
          <input value={s.serviceUrl} onChange={(e) => void update({ serviceUrl: e.target.value.replace(/\/+$/, '') })} size={28} />
        </label>
      </p>

      <h3>Test</h3>
      <p>
        {SAMPLE} <SpeakButton text={SAMPLE} />
      </p>
    </section>
  );
}
