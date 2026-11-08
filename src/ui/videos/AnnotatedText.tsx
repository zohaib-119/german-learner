import type { Annotated, Part } from '../../core/video';

/** A subtitle line where known words show their meaning on hover/focus and can be clicked. */
export function AnnotatedText({ annotated, onPick }: { annotated: Annotated; onPick: (part: Part) => void }) {
  return (
    <>
      {annotated.parts.map((p, i) =>
        p.meaning ? (
          <span key={i} className={`gloss vid-gloss ${p.source}`} tabIndex={0} role="button" onClick={() => onPick(p)} onKeyDown={(e) => e.key === 'Enter' && onPick(p)}>
            {p.text}
            <span className="gloss-tip" role="tooltip">
              {p.meaning}
            </span>
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
