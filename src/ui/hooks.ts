import { useCallback, useEffect, useRef, useState } from 'react';

// ---- tiny hash router --------------------------------------------------------------------------

export interface Route {
  path: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [p = '', q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function href(path: string, query?: Record<string, string>): string {
  const q = query ? `?${new URLSearchParams(query)}` : '';
  return `#/${path.replace(/^\/+/, '')}${q}`;
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---- async data ---------------------------------------------------------------------------------

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setLoading(true);
    fnRef.current().then((d) => {
      if (live) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// ---- keyboard ----------------------------------------------------------------------------------

/** Global key handler. Keys typed inside inputs are ignored so typing never triggers shortcuts. */
export function useKeys(handlers: Record<string, () => void>, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A focused button handles Enter/Space itself (native click); don't also fire the shortcut.
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
      const h = ref.current[e.key];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled]);
}
