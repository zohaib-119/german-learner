// The extension's own library of finished subtitles, so a video is never sent to the AI twice.
// Stored in chrome.storage.local (with the unlimitedStorage permission). The app keeps its own copy;
// this one also acts as a backup that can be re-sent to the app at any time.
import type { VideoFile } from '../../src/core/video/schema';

export interface LibraryEntry {
  video: VideoFile;
  createdAt: number;
  provider: string;
}

const key = (videoId: string) => `video:${videoId}`;

export async function getEntry(videoId: string): Promise<LibraryEntry | null> {
  const r = await chrome.storage.local.get(key(videoId));
  return (r[key(videoId)] as LibraryEntry | undefined) ?? null;
}

export async function putEntry(video: VideoFile, provider: string): Promise<void> {
  const entry: LibraryEntry = { video, createdAt: Date.now(), provider };
  await chrome.storage.local.set({ [key(video.video.id)]: entry });
}

export async function removeEntry(videoId: string): Promise<void> {
  await chrome.storage.local.remove(key(videoId));
}
