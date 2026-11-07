import { Repeat, Turtle, TriangleAlert, Volume2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { player } from '../audio/player';
import { useAudioError } from '../audio/status';
import type { Lexicon, LexItem } from '../core/vocab';

// ---- audio controls -----------------------------------------------------------------------------

/** Play / slow / repeat ×3 for a text. `compact` shows only play + slow. */
export function SpeakButton({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <span className="speak">
      <button className="icon-btn" title="Play" aria-label={`Play: ${text}`} onClick={() => void player.play(text)}>
        <Volume2 size={18} />
      </button>
      <button className="icon-btn" title="Slow" aria-label={`Play slowly: ${text}`} onClick={() => void player.play(text, { slow: true })}>
        <Turtle size={18} />
      </button>
      {!compact && (
        <button className="icon-btn" title="Repeat 3×" aria-label={`Repeat three times: ${text}`} onClick={() => void player.play(text, { repeat: 3 })}>
          <Repeat size={18} />
        </button>
      )}
    </span>
  );
}

/** Large round play button used on listening cards. */
export function PlayCircle({ text, label = 'Play' }: { text: string; label?: string }) {
  return (
    <button className="play-circle" title={`${label} (Space)`} aria-label={label} onClick={() => void player.play(text)}>
      <Volume2 size={40} />
    </button>
  );
}

export function AudioBanner() {
  const error = useAudioError();
  if (!error) return null;
  return (
    <div className="banner warn" role="status">
      <TriangleAlert size={16} />
      <span>Audio offline · run <code>npm run tts</code></span>
    </div>
  );
}

// ---- text ---------------------------------------------------------------------------------------

export function articleClass(article?: string): string {
  return article === 'der' ? 'art-der' : article === 'die' ? 'art-die' : article === 'das' ? 'art-das' : '';
}

/** A vocabulary entry: coloured article + word. */
export function Word({ item, size = 'md' }: { item: Pick<LexItem, 'de' | 'article'>; size?: 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`word word-${size}`}>
      {item.article && <span className={`article ${articleClass(item.article)}`}>{item.article}</span>}
      <span className="word-de">{item.de}</span>
    </span>
  );
}

/** German text where known words can be hovered / focused to see their meaning. */
export function GlossText({ text, lexicon }: { text: string; lexicon: Lexicon<LexItem> }) {
  const parts = text.split(/(\p{L}+(?:-\p{L}+)*)/gu);
  return (
    <>
      {parts.map((p, i) => {
        const hit = i % 2 === 1 ? lexicon.lookup(p) : undefined;
        if (!hit) return p;
        return (
          <span key={i} className="gloss" tabIndex={0}>
            {p}
            <span className="gloss-tip" role="tooltip">
              {hit.article && <b className={articleClass(hit.article)}>{hit.article} </b>}
              {hit.de} · {hit.en}
            </span>
          </span>
        );
      })}
    </>
  );
}

/** Buttons that insert German letters at the cursor of an input (for keyboards without them). */
export function SpecialChars({ inputRef, value, onChange }: { inputRef: RefObject<HTMLInputElement | null>; value: string; onChange: (v: string) => void }) {
  const insert = (ch: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + ch + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + ch.length, start + ch.length);
    });
  };
  return (
    <div className="chars" aria-label="German letters">
      {['ä', 'ö', 'ü', 'ß'].map((c) => (
        <button type="button" key={c} className="char" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}

// ---- layout bits --------------------------------------------------------------------------------

export function ProgressBar({ value, max, tone = 'primary', label }: { value: number; max: number; tone?: 'primary' | 'success'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warn' }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
