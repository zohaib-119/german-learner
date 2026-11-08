// Local stand-ins for a YouTube watch page and a ChatGPT-like chat, used by extension.e2e.mjs.
// They copy only the page structure the extension relies on; they are not the real sites.
import http from 'node:http';

const SEGMENTS = [
  ['0:00', 'Hallo und willkommen'], ['0:02', 'zu unserem Video.'], ['0:04', 'Heute gehen wir'], ['0:06', 'zum Bäcker.'],
  ['0:09', 'Der Bäcker steht'], ['0:11', 'jeden Tag früh auf.'], ['0:14', 'Ich kaufe zwei Brötchen'], ['0:16', 'und einen Kaffee.'],
  ['0:19', 'Das kostet'], ['0:21', 'drei Euro.'], ['0:24', 'Vielen Dank'], ['0:26', 'und bis bald!'],
];

const youtubePage = (id, withTranscript) => `<!doctype html><html><head><title>Beim Bäcker (test) - YouTube</title></head><body>
<div id="movie_player"></div>
<div id="description-inline-expander"><button id="expand">…more</button>
  <div id="more" hidden>${withTranscript ? '<ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>' : ''}</div>
</div>
<div id="panel"></div>
<script>
  document.getElementById('movie_player').getPlayerResponse = () => ({
    videoDetails: { videoId: '${id}', title: 'Beim Bäcker (test)', author: 'Test Kanal', lengthSeconds: '29' },
    captions: ${withTranscript ? `{ playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: '/timedtext?empty=1', languageCode: 'de', kind: 'asr', name: { simpleText: 'Deutsch (automatisch)' } }] } }` : 'undefined'},
  });
  document.getElementById('expand').onclick = () => { document.getElementById('more').hidden = false; };
  const btn = document.querySelector('ytd-video-description-transcript-section-renderer button');
  if (btn) btn.onclick = () => setTimeout(() => {
    const panel = document.getElementById('panel');
    const rows = ${JSON.stringify(SEGMENTS)}.map(([t, s]) =>
      '<ytd-transcript-segment-renderer><div class="segment-timestamp">' + t + '</div><yt-formatted-string class="segment-text">' + s + '</yt-formatted-string></ytd-transcript-segment-renderer>').join('');
    // The same list appears twice on the page (the cause of repeated lines seen on real YouTube).
    panel.innerHTML = rows + '<div class="copy">' + rows + '</div>'
      + '<ytd-transcript-footer-renderer><yt-dropdown-menu>Deutsch (automatisch erzeugt)</yt-dropdown-menu></ytd-transcript-footer-renderer>';
  }, 300);
</script></body></html>`;

const chatPage = `<!doctype html><html><head><title>Mock chat</title>
<style>#prompt-textarea{min-height:40px;border:1px solid #ccc;white-space:pre-wrap} pre{background:#eee}</style></head><body>
<main id="thread"></main>
<div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
<button data-testid="send-button" disabled>Send</button>
<script>
  const box = document.getElementById('prompt-textarea');
  const send = document.querySelector('[data-testid="send-button"]');
  const thread = document.getElementById('thread');
  const sync = () => { send.disabled = !box.innerText.trim(); };
  box.addEventListener('paste', (e) => { e.preventDefault(); box.innerText = e.clipboardData.getData('text/plain'); sync(); });
  box.addEventListener('input', sync);
  window.__prompts = [];
  let firstAnswer = true;
  send.onclick = () => {
    const prompt = box.innerText; window.__prompts.push(prompt);
    box.innerText = ''; sync();
    const user = document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = prompt; thread.appendChild(user);
    const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop'; document.body.appendChild(stop);
    const lines = [...prompt.matchAll(/^(\\d+) \\| (.+)$/gm)].map((m) => ({ i: Number(m[1]), text: m[2] }));
    // The first answer leaves out line 2 so the extension has to ask again.
    const answered = firstAnswer ? lines.filter((l) => l.i !== 2) : lines;
    firstAnswer = false;
    const json = JSON.stringify(answered.map((l) => ({
      i: l.i, t: 'EN: ' + l.text,
      g: l.text.replace(/[.,!?]/g, '').split(' ').map((w) => ({ w, b: w.toLowerCase(), k: 'other', m: 'meaning of ' + w })),
      p: [{ p: l.text.split(' ').slice(0, 2).join(' '), m: 'phrase meaning', n: 'literally: test' }],
    })));
    const msg = document.createElement('div'); msg.dataset.messageAuthorRole = 'assistant';
    msg.innerHTML = '<p>Here you go:</p><pre><div>json</div><code></code></pre>';
    setTimeout(() => {
      thread.appendChild(msg);
      const code = msg.querySelector('code'); const parts = 3; let k = 0;
      const t = setInterval(() => { k++; code.textContent = json.slice(0, Math.ceil(json.length * k / parts)); if (k === parts) { clearInterval(t); setTimeout(() => stop.remove(), 300); } }, 400);
    }, 600);
  };
</script></body></html>`;

export function startMockSites(port = 4599) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (body, type = 'text/html') => { res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(body); };
    if (url.pathname === '/watch') return send(youtubePage(url.searchParams.get('v'), url.searchParams.get('v') !== 'abcdefghijk'));
    if (url.pathname === '/chat') return send(chatPage);
    if (url.pathname === '/timedtext') return send('', 'text/plain'); // like YouTube: empty without a token
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
