# Video Subtitle Format (schema_version 1)

The **Videos** page plays a YouTube video with learning subtitles: the original line, its translation, and short meanings for hard words. You usually get these files from the browser extension (see `extension/README.md`), which creates them for you. This page describes the format, in case you want to make or edit one yourself.

The Videos page accepts:

- **`.json` / `.yaml`**: a finished file in the format below.
- **`.srt` / `.vtt`**: plain subtitles. The app asks for the YouTube link and imports the lines without translations.

## Format

```json
{
  "kind": "video",
  "schema_version": 1,
  "title": "Beim Bäcker",
  "channel": "My channel",
  "level": "A2",
  "video": { "provider": "youtube", "id": "VIDEO_ID_11" },
  "language": "de",
  "translation_language": "en",
  "segments": [
    {
      "start": 8.0,
      "end": 12.5,
      "text": "Heute steht der Bäcker früh auf.",
      "translation": "Today the baker gets up early.",
      "glossary": [
        { "word": "steht auf", "meaning": "gets up (aufstehen)" },
        { "word": "Bäcker", "meaning": "the baker (der Bäcker)" }
      ]
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `kind` | yes | Always `"video"`. |
| `title` | yes | Shown in the library and player. |
| `video.provider` / `video.id` | yes | `"youtube"` and the 11-character id from the link (`watch?v=`**`dQw4w9WgXcQ`**). |
| `segments` | yes (≥ 1) | The subtitle lines, see below. |
| `id` | no | Defaults to `yt-<video id>`. Importing the same id again replaces the subtitles but keeps your playback position. |
| `channel`, `level`, `duration` | no | For display. |
| `language`, `translation_language` | no | Default `de` and `en`. |

Each segment:

| Field | Required | Notes |
| --- | --- | --- |
| `start`, `end` | yes | Seconds from the start of the video. Lines are sorted by `start`. A wrong `end` is repaired on import. |
| `text` | yes | The line as spoken. |
| `translation` | no | Shown under the line when translations are on. |
| `glossary` | no | Words to highlight. `word` must be written as it appears in the line, ignoring case. For a separable verb whose parts are split in the line ("steht … früh auf"), write both parts in order: `"steht auf"`; both parts get highlighted. An entry that can't be found in the line is listed under it instead. |

Words you have learned in your lessons are also highlighted with their meaning automatically (green underline), so the glossary only needs the words you haven't met yet.

## Doing it by hand with an AI chat

You don't need this if you use the extension, which sends exactly this kind of prompt. To do it manually:

1. Get the transcript: on YouTube, open **…more → Show transcript** and copy the lines.
2. Paste this into ChatGPT or Claude, followed by the lines numbered `1 | text`, `2 | text`, ….

```text
You are helping a A2 learner of German study a video. Below are numbered German subtitle lines.
For EVERY line give its English translation and the meanings of the words the learner may not know.

Reply with ONE JSON array inside a single json code block and nothing else.
Return exactly one object per numbered line, in the same order:
{"i": <line number>, "t": "<English translation>", "g": [{"w": "<word as written in the line>", "m": "<short meaning>"}]}

Rules:
- Never skip, merge, split or renumber lines.
- "g": only words an A2 learner is likely NOT to know; at most 6 per line; [] if none.
- "w" copied exactly from the line. For a separable verb split in the line, write both parts, e.g. "steht auf".
- "m": meaning in context plus the base form, e.g. "gets up (aufstehen)"; nouns with article.
- Valid JSON only.
```

3. Then build the file. The easiest way is still the extension's job page: if reading the transcript fails, it lets you paste the transcript and does the rest. Otherwise, write the `segments` by hand using the times from the transcript.
