import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Finds a Chromium: CHROMIUM_PATH, or one installed by Playwright under ~/.cache/ms-playwright. */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dir = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  const exe = dir && path.join(root, dir, 'chrome-linux64', 'chrome');
  if (!exe || !fs.existsSync(exe)) throw new Error('No Chromium found. Set CHROMIUM_PATH or run: npx playwright-core install chromium');
  return exe;
}

export const APP_URL = process.env.APP_URL || 'http://localhost:5174';
export const here = (...p) => path.join(path.dirname(fileURLToPath(import.meta.url)), ...p);

export async function launch(extraArgs = []) {
  return chromium.launch({ executablePath: chromiumPath(), args: ['--headless=new', '--no-sandbox', ...extraArgs] });
}

/** Tiny assertion reporter shared by the scripts. */
export function reporter() {
  let failed = 0;
  return {
    ok(name, cond, extra = '') {
      if (!cond) failed++;
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
    },
    done(errors = []) {
      console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
      console.log(failed || errors.length ? `${failed} FAILED` : 'ALL PASSED');
      process.exitCode = failed || errors.length ? 1 : 0;
    },
  };
}
