import { useSyncExternalStore } from 'react';

/** Last audio error (null when audio works). Lets any screen show one consistent "audio offline" notice. */
let error: string | null = null;
const listeners = new Set<() => void>();

export const audioStatus = {
  get: () => error,
  set(next: string | null) {
    if (next === error) return;
    error = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function useAudioError(): string | null {
  return useSyncExternalStore(audioStatus.subscribe, audioStatus.get);
}
