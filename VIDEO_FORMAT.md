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
        { "word": "Heute", "meaning": "today", "base": "heute", "kind": "adverb" },
        { "word": "steht auf", "meaning": "gets up", "base": "aufstehen", "kind": "verb" },
        { "word": "der", "meaning": "the", "base": "der", "kind": "article" },
        { "word": "Bäcker", "meaning": "the baker", "base": "der Bäcker", "kind": "noun" },
        { "word": "früh", "meaning": "early", "base": "früh", "kind": "adverb" }
      ],
      "phrases": [
        { "text": "früh auf", "meaning": "up early", "note": "literally: early up; with stehen it means getting out of bed early" }
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
| `glossary` | no | Each entry is `word`, `meaning`, and optionally `base` (dictionary form, e.g. `der Bäcker`, `aufstehen`) and `kind` (noun, verb, …). Words to highlight. `word` must be written as it appears in the line, ignoring case. For a separable verb whose parts are split in the line ("steht … früh auf"), write both parts in order: `"steht auf"`; both parts get highlighted. An entry that can't be found in the line is listed under it instead. |
| `phrases` | no | Fixed expressions whose meaning is more than their words: `text` (as in the line), `meaning`, and an optional `note` explaining why (the literal meaning). Shown under the line. |

By default the extension asks the AI to explain **every word of every line**, repeats included, so a complete beginner never has to look back. Choose "Only harder words" in the extension settings for less.

**Create lesson** on the video page turns a video into a normal lesson. Its content words and phrases become word and phrase items, using the video line as the example, and its sentences become listen-and-choose and word-order exercises. **Lesson file** downloads the same lesson in the [lesson format](LESSON_FORMAT.md).

Words you have learned in your lessons are also highlighted with their meaning automatically (green underline), so the glossary only needs the words you haven't met yet.

## Doing it by hand with an AI chat

You don't need this if you use the extension, which sends exactly this kind of prompt. To do it manually:

1. Get the transcript: on YouTube, open **…more → Show transcript** and copy the lines.
2. Paste this into ChatGPT or Claude, followed by the lines numbered `1 | text`, `2 | text`, ….

```text
You are helping a complete beginner (knows no words yet) learner of German study a video.
Below are numbered German subtitle lines. For EVERY line give its English translation,
the meaning of every word, and every phrase explained.

Reply with ONE JSON array inside a single json code block and nothing else, one object per line:
{"i": <line number>, "t": "<English translation>",
 "g": [{"w": "<word as written>", "b": "<dictionary form>", "k": "<word type>", "m": "<meaning in this line>"}],
 "p": [{"p": "<phrase as written>", "m": "<meaning of the whole phrase>", "n": "<why: literal meaning>"}]}

Rules:
- Never skip, merge, split or renumber lines.
- "g": EVERY word in order, including small words; explain repeated words again every time.
- "b": nouns with article ("der Bäcker"), verbs in the infinitive ("aufstehen").
- For a separable verb split in the line, write both parts as one entry, e.g. "steht auf".
- "p": idioms and fixed expressions ("Wie geht's?", "auf jeden Fall") with the reason in "n".
- Valid JSON only.
```

3. Then build the file. The easiest way is still the extension's job page: if reading the transcript fails, it lets you paste the transcript and does the rest. Otherwise, write the `segments` by hand using the times from the transcript.
