import { useState } from 'react';
import { player } from '../audio/player';

/** 🔊 normal, 🐢 slow, 🔁 three times. Errors are shown inline so a silent failure is never a mystery. */
export function SpeakButton({ text }: { text: string }) {
  const [error, setError] = useState<string | null>(null);

  async function go(opts: Parameters<typeof player.play>[1]) {
    setError(null);
    try {
      await player.play(text, opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <span className="speak">
      <button title="Play" aria-label={`Play ${text}`} onClick={() => void go({})}>🔊</button>
      <button title="Slow" aria-label={`Play ${text} slowly`} onClick={() => void go({ slow: true })}>🐢</button>
      <button title="Repeat ×3" aria-label={`Repeat ${text} three times`} onClick={() => void go({ repeat: 3 })}>🔁</button>
      {error && <span className="err small"> {error}</span>}
    </span>
  );
}
