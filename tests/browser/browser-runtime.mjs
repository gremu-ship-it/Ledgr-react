/**
 * R09.4 — real-browser runtime bootstrap (zero simulation):
 * playwright-core drives a genuine Chromium binary (extracted from
 * @sparticuz/chromium, an npm-distributed real browser build). The sandbox
 * image lacks three system libraries (libnspr4/libnss3/libnssutil3); they
 * are taken verbatim from @sparticuz/chromium's own al2023 companion pack —
 * real NSPR/NSS builds, no stubs of any kind (a fake crypto/network layer
 * would invalidate every browser claim).
 */
import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { brotliDecompressSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Extract the al2023 shared-library pack and return its lib dir. */
export function extractAl2023Libs(targetParent = mkdtempSync(join(tmpdir(), 'r094-libs-'))) {
  const br = readFileSync(new URL('../../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url));
  const tar = join(targetParent, 'al2023.tar');
  writeFileSync(tar, brotliDecompressSync(br));
  const out = join(targetParent, 'al2023');
  mkdirSync(out, { recursive: true });
  execFileSync('tar', ['-xf', tar, '-C', out]);
  return join(out, 'lib');
}

let libsDir = null;

export async function browserLaunchOptions(extraArgs = []) {
  if (!libsDir) {
    libsDir = extractAl2023Libs();
    // Chromium inherits the launching process env (playwright child spawn).
    process.env.LD_LIBRARY_PATH = `${libsDir}${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}`;
  }
  const executablePath = await sparticuz.executablePath();
  return {
    executablePath,
    headless: true,
    args: [
      ...sparticuz.args.filter((a) => !a.startsWith('--single-process') && !a.startsWith('--no-zygote')),
      '--no-sandbox', '--disable-dev-shm-usage',
      ...extraArgs,
    ],
  };
}

/**
 * Fresh browser process. extraArgs carries the R09.4 PAC/cert flags
 * (--proxy-pac-url=<pacUrl> --ignore-certificate-errors) so service-worker
 * fetches to the harness host traverse the real network stack (no Playwright
 * interception of SW-originated fetches exists); the seam is labelled on the
 * records that use it.
 */
const proxyArgs = (pacUrl) => {
  // Direct proxy flag: '--proxy-pac-url' is not honoured by the headless
  // chromium build used here (verified 2026-09-23); CONNECT-tunnel mode is.
  // Sensitive scope: only the harness host traverses the tunnel; loopback is
  // bypassed so the app/stub origin stays direct.
  if (!pacUrl) return [];
  const { hostname, port } = new URL(pacUrl);
  return [
    `--proxy-server=${hostname}:${port}`,
    '--proxy-bypass-list=127.0.0.1;localhost',
    '--ignore-certificate-errors',
  ];
};

export async function launchBrowser({ pacUrl = null } = {}) {
  const opts = await browserLaunchOptions(proxyArgs(pacUrl));
  return chromium.launch(opts);
}

export async function launchPersistent(userDataDir, { pacUrl = null } = {}) {
  const opts = await browserLaunchOptions(proxyArgs(pacUrl));
  return chromium.launchPersistentContext(userDataDir, { ...opts, serviceWorkers: 'allow' });
}

export function chromiumVersionLabel(browser) {
  return `Chromium ${browser.version()} (headless real browser process; playwright-core driving @sparticuz/chromium)`;
}
