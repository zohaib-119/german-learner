# Deutsch Trainer – Video Subtitles (browser extension)

Turns any YouTube video into learning subtitles in a few clicks, using the AI chat you are already logged in to (ChatGPT or Claude). No API keys.

**What happens when you click it on a YouTube video:**

1. **Transcript.** It opens YouTube's own *Show transcript* panel in your tab and reads the timed lines.
2. **AI.** It opens a new chat (ChatGPT or Claude), pastes the lines in parts with instructions, and waits for each answer. The answer contains a translation of every line and short meanings for the words a learner at your level may not know. If a line is missing from an answer, it asks again for just that line.
3. **Build.** It combines the answers with the original lines. **Timing and German text always come from YouTube, never from the AI**, so the subtitles stay in sync. The result is checked against the same format the app uses.
4. **App.** It opens Deutsch Trainer's **Videos** page and hands the subtitles over. The video starts in the player with hover-for-meaning subtitles.

You can watch the progress on the extension's job page, which also lets you download the result as `.json` or `.srt`.

## Install

```bash
npm install            # once, from the project root
npm run ext:build      # builds into extension/dist
```

1. Open `chrome://extensions` (also works in Edge and Brave).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/dist` folder.

After changing the code, run `npm run ext:build` again (or keep `npm run ext:watch` running) and press the reload button on the extension card.

## Use

1. Start the app (`npm run dev`) and make sure you are logged in to ChatGPT or Claude in the same browser.
2. Open a YouTube video.
3. Click the extension icon and press **Create subtitles for this video**, or right-click the page and choose **Create learning subtitles for this video**.
4. Leave the tabs alone until the job page says it is done. A 10-minute video takes a few AI messages, which usually takes a few minutes.

### Settings

Open them from the popup (**Settings**) or at the bottom of the job page.

| Setting | Default | Notes |
| --- | --- | --- |
| AI chat | ChatGPT | ChatGPT uses a temporary chat, so nothing is added to your history. |
| Chat URL | empty | Use a specific chat or project URL instead of a new chat. |
| Your level | A2 | Decides which words get meanings. |
| Video language / code | German / `de` | The code picks the caption track if the panel can't be read. |
| Translate into / code | English / `en` | |
| App address | `http://localhost:5173` | Change it if your app runs on another port. |
| Lines per message | 40 | Lower it if the AI cuts its answers short. |
| Close the AI tab when done | on | |
| Also download the files | off | Downloads `.json` and `.srt` automatically. |

## When something goes wrong

| What you see | What to do |
| --- | --- |
| "Could not read the transcript… Paste it below" | On YouTube open **…more → Show transcript**, select all the lines, copy and paste them into the box on the job page. `.srt`/`.vtt` text works too. Videos without any captions can't be used. |
| "did not start answering. Are you logged in?" | Log in to the AI site in this browser and start again. |
| "did not accept the text in its chat box" or the job hangs on the AI step | The AI site probably changed its page. The selectors are at the top of `src/ai-content.ts`. |
| "Is the app running at …?" | Start the app, check the address in Settings, then press **Send to app again**. You can also download the `.json` and drop it on the app's Videos page. |
| Some lines have no translation | The AI skipped them twice. They still play with the German text; you can re-run the video later. |

**Details** at the bottom of the job page shows a log of every step, which helps when reporting a problem.

## Privacy and rules

- The transcript is sent to the AI chat you choose, under your account. Nothing else leaves your browser, and the extension has no server.
- Reading a transcript with an extension is not an official YouTube feature, and AI sites don't offer automation either. This is meant for **personal use**. Pages can change at any time, which can break a step until the selectors are updated.
- The finished subtitles are stored only in your app. Don't publish other people's transcripts.

## How it is built

```
extension/
  manifest.json        Manifest V3: permissions, content scripts
  build.mjs            esbuild bundler -> dist/
  src/
    popup.*            toolbar popup: starts a job for the current YouTube tab
    background.ts      right-click menu entry on YouTube pages
    job.*              the job page: runs the pipeline and shows progress (no service-worker time limits)
    youtube-scrape.ts  injected into the YouTube tab; reads the transcript panel, falls back to the caption track
    ai-content.ts      content script on ChatGPT / Claude: writes the prompt, sends it, waits for the reply
    app-content.ts     content script on localhost: passes the result to the app with window.postMessage
    settings.ts        stored settings
```

The prompt, the reply parser, line merging and the file format live in the app's `src/core/video/`, which the extension imports. The two can't drift apart, and that logic is unit-tested with the app (`npm test`).

The app accepts results only from same-window messages with the expected envelope, and validates them with the same schema as a manual import (`src/ui/videos/bridge.ts`).

### Development

```bash
npm run ext:watch        # rebuild on change
npm run ext:typecheck
npm run e2e:extension    # loads the built extension in Chromium against mock YouTube/chat pages (app must run on :5174)
```

The end-to-end test uses local mock pages that copy the structure the extension relies on (`e2e/mock-sites.mjs`). It proves the extension's own logic, not that today's YouTube, ChatGPT or Claude pages still match.
