// Builds the extension into extension/dist (load that folder in chrome://extensions).
//   node extension/build.mjs            one-off build
//   node extension/build.mjs --watch    rebuild on change
// EXTENSION_TEST_HOSTS="http://localhost:4599/*" adds extra AI-chat hosts (used by the e2e test's mock chat).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const testHosts = (process.env.EXTENSION_TEST_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (testHosts.length) {
  manifest.content_scripts[0].matches.push(...testHosts);
  manifest.host_permissions.push(...testHosts);
  manifest.name += ' (test build)';
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const f of ['popup.html', 'job.html', 'job.css']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));

const options = {
  entryPoints: ['background', 'popup', 'job', 'ai-content', 'app-content'].map((n) => path.join(root, 'src', `${n}.ts`)),
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  logLevel: 'info',
};
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching for changes…');
} else {
  await esbuild.build(options);
}
