import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineId } from '../audio/engine';
import { player } from '../audio/player';
import { fetchHealth, type ServiceHealth } from '../audio/service';
import { DEFAULT_AUDIO_SETTINGS, getAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/settings';
import { DEFAULT_LEARNING, getLearningSettings, saveLearningSettings, type LearningSettings } from '../core/settings';
import { AudioBanner, PageHeader, Switch } from './components';

const SAMPLE = 'Ich hätte gern ein Brötchen, bitte.';
const ENGINES: { id: EngineId; label: string; hint: string }[] = [
  { id: 'piper', label: 'Piper', hint: 'Offline' },
  { id: 'edge', label: 'Edge', hint: 'Online' },
];

export function SettingsPage() {
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [learning, setLearning] = useState<LearningSettings>(DEFAULT_LEARNING);
  const [health, setHealth] = useState<ServiceHealth | null | 'loading'>('loading');

  useEffect(() => {
    void getAudioSettings().then(setAudio);
    void getLearningSettings().then(setLearning);
    void fetchHealth().then(setHealth);
  }, []);

  const ready = (id: EngineId) => health !== 'loading' && health !== null && health.engines[id].available;
  const voices = health !== 'loading' && health ? health.engines[audio.engine].voices : [];
  const voiceKey = audio.engine === 'piper' ? 'piperVoice' : 'edgeVoice';

  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings-grid">
      <section className="card settings">
        <h2>Voice</h2>
        <div className="segmented" role="radiogroup" aria-label="Voice engine">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={audio.engine === e.id}
              className={`segment ${audio.engine === e.id ? 'active' : ''}`}
              onClick={async () => setAudio(await saveAudioSettings({ engine: e.id }))}
            >
              <span className={`dot ${health === 'loading' ? '' : ready(e.id) ? 'ok' : 'off'}`} />
              {e.label}
              <span className="muted">{e.hint}</span>
            </button>
          ))}
        </div>
        {health === null && <AudioOfflineNote />}
        <div className="setting">
          <label htmlFor="voice">Voice</label>
          <select id="voice" value={audio[voiceKey]} onChange={async (e) => setAudio(await saveAudioSettings({ [voiceKey]: e.target.value }))}>
            {(voices.length ? voices : [audio[voiceKey]]).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <button className="btn sm" onClick={() => void player.play(SAMPLE)}>
          <Volume2 size={16} /> Test
        </button>
        <AudioBanner />
      </section>

      <section className="card settings">
        <h2>Learning</h2>
        <div className="setting">
          <label htmlFor="newper">New words per session</label>
          <select id="newper" value={learning.newPerSession} onChange={async (e) => setLearning(await saveLearningSettings({ newPerSession: Number(e.target.value) }))}>
            {[4, 6, 8, 10, 15, 20].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="setting">
          <label>Auto-play audio</label>
          <Switch label="Auto-play audio" checked={learning.autoplay} onChange={async (v) => setLearning(await saveLearningSettings({ autoplay: v }))} />
        </div>
        <div className="setting">
          <label>Strict capitalization</label>
          <Switch label="Strict capitalization" checked={learning.strictCaps} onChange={async (v) => setLearning(await saveLearningSettings({ strictCaps: v }))} />
        </div>
      </section>
      </div>
    </>
  );
}

function AudioOfflineNote() {
  return (
    <p className="muted">
      TTS service not running. Start it with <code>npm run tts</code>.
    </p>
  );
}
