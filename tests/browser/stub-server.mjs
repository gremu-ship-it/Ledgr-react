/**
 * R09.4 — in-origin protocol stub + static server for browser evidence.
 *
 * Serves (on one localhost origin):
 *   /                    → built PWA (dist) with SPA fallback (SW-capable)
 *   /pages/*             → the esbuild-bundled harness pages
 *   /auth/v1/user        → scenario-controlled actor (synthetic auth seam,
 *                          labelled in every record that relies on it)
 *   /rest/v1/rpc/<fn>    → pre-registered per-clientKey scenarios; every call logged
 *   /rest/v1/* (other)   → empty PostgREST-shaped responses (synthetic data)
 *   /__control__         → node-side scenario/actor registration + call log
 *
 * NO real backend exists behind this server. Records that require real
 * server-side revalidation are recorded BLOCKED with that exact limitation;
 * client-path and storage assertions made against this seam are labelled.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFile, stat, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, extname, resolve } from 'node:path';

/**
 * SW-traffic plumbing (zero Playwright interception of service-worker
 * fetches): Chromium is pointed at a local PAC; only the harness host
 * (r094.invalid) is proxied via CONNECT to a local TLS terminator holding a
 * synthetic self-signed certificate. The SW's NetworkFirst workbox fetch is
 * a REAL network request end to end (DNS→PAC→CONNECT→TLS over kernel
 * sockets); the environmental seam is labelled on each record using it.
 */
const HARNESS_HOST = 'r094.invalid';

async function ensureSelfSignedCert(dir) {
  const key = join(dir, 'r094.invalid.key.pem');
  const cert = join(dir, 'r094.invalid.cert.pem');
  await mkdir(dir, { recursive: true });
  try { await access(key); await access(cert); return { key, cert }; } catch { /* mint */ }
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2',
    '-subj', `/CN=${HARNESS_HOST}`,
    '-addext', `subjectAltName=DNS:${HARNESS_HOST}`,
  ], { stdio: 'ignore' });
  return { key, cert };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

export async function createStubServer({ distDir, pagesDir, tlsCertDir = null }) {
  const scenarios = new Map(); // `${fn}|${clientKey}` → { mode, status, body, delayMs }
  const calls = [];            // rpc call log
  // Current dist dir is MUTABLE via control so Phase-A SW update evidence can
  // swap the served build on the same origin (A→B) mid-session.
  let currentDistDir = distDir;
  // Minimal PostgREST data seam: rows "committed" by a successful rpc
  // scenario (the only modeled writes) become readable shadows, so the
  // production read-back path (findByIdWithLines) sees exactly one row.
  const shadows = { invoices: new Map() }; // id → row
  let actor = null;            // scenario-controlled authenticated actor object
  const json = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...extraHeaders });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { res(JSON.parse(b || 'null')); } catch { res(null); } }); });

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://stub');
    const path = url.pathname;

    if (req.method === 'OPTIONS') { json(res, 200, {}, { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return; }

    if (path === '/__control__' && req.method === 'POST') {
      const body = await readBody(req);
      if (body?.action === 'setActor') { actor = body.actor; json(res, 200, { ok: true }); return; }
      if (body?.action === 'setScenario') {
        scenarios.set(`${body.fn}|${body.clientKey}`, { status: body.status ?? 200, body: body.body, delayMs: body.delayMs ?? 0 });
        json(res, 200, { ok: true }); return;
      }
      if (body?.action === 'calls') { json(res, 200, { calls }); return; }
      if (body?.action === 'resetCalls') { calls.length = 0; json(res, 200, { ok: true }); return; }
      if (body?.action === 'setDistDir') { currentDistDir = body.dirAbs; json(res, 200, { ok: true }); return; }
      if (body?.action === 'resetAll') { scenarios.clear(); calls.length = 0; actor = null; shadows.invoices.clear(); json(res, 200, { ok: true }); return; }
      json(res, 400, { error: 'unknown action' }); return;
    }

    if (path === '/auth/v1/user') {
      if (!actor) { json(res, 401, { code: 401, msg: 'R09.4 stub: no scenario actor registered', error_code: 'session_not_found' }); return; }
      json(res, 200, actor);
      return;
    }
    if (path === '/auth/v1/token' || path === '/auth/v1/logout') { json(res, 200, {}); return; }

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      const body = await readBody(req);
      const clientKey = body?.client_key ?? body?.p_request?.client_key ?? body?.p_payload?.client_key ?? null;
      const entry = clientKey ? scenarios.get(`${fn}|${clientKey}`) : null;
      calls.push({ fn, clientKey, body, at: new Date().toISOString() });
      if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
      if (!entry) { json(res, 404, { code: 'PGRST202', message: `R09.4 stub: no scenario for fn=${fn} clientKey=${clientKey}` }); return; }
      if (entry.status === 200 && fn === 'post_pos_sale' && entry.body && typeof entry.body.id === 'string') {
        shadows.invoices.set(entry.body.id, {
          id: entry.body.id,
          business_id: body?.p_payload?.business_id ?? null,
          invoice_number: entry.body.number ?? null,
          invoice_type: 'sales', status: 'posted',
          client_key: clientKey,
          journal_entry_id: entry.body.journal_entry_id ?? null,
        });
      }
      json(res, entry.status, entry.body);
      return;
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length).split('?')[0];
      calls.push({ fn: `GET ${table}`, clientKey: null, body: null, via: req.socket?.encrypted ? 'tls' : 'plain', at: new Date().toISOString() });
      const wantsObject = (req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
      const idEq = url.searchParams.get('id');
      if (table === 'invoices' && idEq?.startsWith('eq.')) {
        const row = shadows.invoices.get(idEq.slice(3)) ?? null;
        if (wantsObject) {
          if (!row) { json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains 0 rows`, hint: null }); return; }
          json(res, 200, row);
          return;
        }
        json(res, 200, row ? [row] : []);
        return;
      }
      // Synthetic data seam: everything else behaves as an empty dataset (PostgREST-shaped).
      json(res, 200, [], { 'content-range': '0-0/0' });
      return;
    }
    if (path.startsWith('/storage/v1/')) { json(res, 404, { statusCode: '404', error: 'not_found', message: 'R09.4 stub: storage not modelled' }); return; }

    if (path.startsWith('/pages/')) {
      const f = join(pagesDir, path.slice('/pages/'.length));
      try { const st = await stat(f); if (!st.isFile()) throw 0; res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(f)); }
      catch { json(res, 404, { error: 'page not found' }); }
      return;
    }

    // PWA static + SPA fallback
    let rel = path === '/' ? 'index.html' : path.slice(1);
    let f = resolve(join(currentDistDir, rel));
    if (!f.startsWith(resolve(currentDistDir))) { json(res, 403, { error: 'forbidden' }); return; }
    try { const st = await stat(f); if (!st.isFile()) throw 0; }
    catch { f = join(currentDistDir, 'index.html'); }
    const headers = { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' };
    if (rel === 'sw.js') { headers['cache-control'] = 'no-cache'; headers['service-worker-allowed'] = '/'; }
    res.writeHead(200, headers);
    res.end(await readFile(f));
  };

  const server = http.createServer(handler);

  // TLS terminator for the harness host (synthetic cert; real TLS/TCP).
  let tlsServer = null, tlsPort = null, pacServer = null, pacUrl = null;
  if (tlsCertDir) {
    const { key, cert } = await ensureSelfSignedCert(tlsCertDir);
    const [keyPem, certPem] = await Promise.all([readFile(key), readFile(cert)]);
    tlsServer = https.createServer({ key: keyPem, cert: certPem }, handler);
    if (process.env.R094_STUB_DEBUG === '1') {
      tlsServer.on('tlsClientError', (e, s) => process.stderr.write(`[stub-tls] clientError ${e.message} ${s?.remoteAddress}\n`));
      tlsServer.on('secureConnection', () => process.stderr.write('[stub-tls] secureConnection\n'));
      tlsServer.on('connection', () => process.stderr.write('[stub-tls] raw connection\n'));
    }
    await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
    tlsPort = tlsServer.address().port;
    // PAC + CONNECT tunnel: Chromium resolves r094.invalid through this.
    const dbg = process.env.R094_STUB_DEBUG === '1' ? (m) => process.stderr.write(`[stub-pac] ${m}\n`) : () => {};
    pacServer = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://pac');
      dbg(`request ${req.method} ${req.url}`);
      if (u.pathname === '/proxy.pac') {
        res.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig' });
        res.end(`function FindProxyForURL(url, host) { if (host === '${HARNESS_HOST}') { return 'PROXY 127.0.0.1:${pacServer.address().port}'; } return 'DIRECT'; }`);
        return;
      }
      res.writeHead(404); res.end();
    });
    pacServer.on('connect', (req, clientSocket, head) => {
      dbg(`CONNECT ${req.url}`);
      // Only the harness host is admitted to the tunnel.
      const [host, portRaw] = (req.url ?? '').split(':');
      const port = Number(portRaw || 443);
      if (host !== HARNESS_HOST) { clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); clientSocket.destroy(); return; }
      const upstream = net.connect(tlsPort, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    await new Promise((r) => pacServer.listen(0, '127.0.0.1', r));
    pacUrl = `http://127.0.0.1:${pacServer.address().port}/proxy.pac`;
  }

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    pacUrl,
    tlsOrigin: tlsPort ? `https://${HARNESS_HOST}` : null,
    close: () => new Promise((r) => server.close(() => { tlsServer?.close?.(); pacServer?.close?.(); r(); })),
    pageUrl: (name) => `${origin}/pages/${name}`,
    // Node http module, NOT global fetch: the R13 harness intentionally
    // disables global fetch; this is the explicit local adapter.
    control: (body) => new Promise((resolve, reject) => {
      const u = new URL(`${origin}/__control__`);
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    }),
  };
}
