// Shared headless-browser launcher for the evidence scripts.
//
// Uses the Chromium that ships with @sparticuz/chromium, so `npm run shots`
// works on a machine with no local Chrome. On Linux those binaries need
// NSS/NSPR, which the same package ships as a tarball — we unpack it to a
// temp dir and point the loader at it, so a bare container needs no apt-get.
//
// Override the target with AVNI_URL (default http://localhost:5173) and the
// browser binary with PUPPETEER_EXECUTABLE_PATH.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { brotliDecompressSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const APP_URL = process.env.AVNI_URL || 'http://localhost:5173';

const LIBS = [
  ['al2023', 'glibc 2.34+ (Debian 12, Ubuntu 22.04+)'],
  ['al2', 'glibc 2.26+ (Amazon Linux 2, Ubuntu 20.04)']
];

// @sparticuz/chromium v153 stopped exporting ./package.json, so resolve the
// entry point and walk up to the package root instead.
function chromiumPackageDir() {
  try {
    return path.dirname(require.resolve('@sparticuz/chromium/package.json'));
  } catch {
    let dir = path.dirname(require.resolve('@sparticuz/chromium'));
    while (!existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return dir;
  }
}

function unpackSharedLibs() {
  if (process.platform !== 'linux') return;
  const root = path.join(tmpdir(), 'avni-chromium-libs');
  const dirs = [];
  for (const [name] of LIBS) {
    const dir = path.join(root, name);
    const lib = path.join(dir, 'lib', 'libnss3.so');
    if (!existsSync(lib)) {
      const archive = path.join(chromiumPackageDir(), 'bin', `${name}.tar.br`);
      if (!existsSync(archive)) continue;
      try {
        mkdirSync(dir, { recursive: true });
        const tar = path.join(root, `${name}.tar`);
        writeFileSync(tar, brotliDecompressSync(readFileSync(archive)));
        execFileSync('tar', ['-xf', tar, '-C', dir]);
        writeFileSync(path.join(root, `.${name}.note`), LIBS.find((l) => l[0] === name)[1]);
      } catch {
        continue; // fall back to whatever the host already provides
      }
    }
    if (existsSync(lib)) dirs.push(path.join(dir, 'lib'));
  }
  if (dirs.length) {
    process.env.LD_LIBRARY_PATH = [...dirs, process.env.LD_LIBRARY_PATH || '']
      .filter(Boolean)
      .join(':');
  }
}

export async function launch({ width = 1680, height = 950, hideScrollbars = true } = {}) {
  unpackSharedLibs();
  const args = [...chromium.args, '--force-color-profile=srgb', '--no-sandbox', '--disable-setuid-sandbox'];
  if (hideScrollbars) args.push('--hide-scrollbars');
  return puppeteer.launch({
    args,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath()),
    headless: true,
    defaultViewport: { width, height }
  });
}

// Every script writes evidence under shots/; downloads go to a temp dir so
// nothing machine-specific ends up in the repo.
export const SHOTS_DIR = path.resolve('shots');
export const DOWNLOAD_DIR = process.env.AVNI_DOWNLOAD_DIR || path.join(tmpdir(), 'avni-downloads');

export function prepareDirs() {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(path.join(SHOTS_DIR, 'responsive'), { recursive: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  return DOWNLOAD_DIR;
}

// Log page-level failures instead of losing them in the terminal noise.
export function watchPage(page, label = 'page') {
  page.on('pageerror', (e) => console.log(`${label} PAGE ERROR:`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`${label} CONSOLE ERROR:`, m.text().slice(0, 200));
  });
  return page;
}
