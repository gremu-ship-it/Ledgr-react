// Execute unchanged, trusted repository handlers in a local VM. NOT Deno/gateway
// verification. Imports are allowlisted; Auth/database/provider boundaries are adapters.
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import * as zod from 'zod';
const root = fileURLToPath(new URL('../../supabase/functions/', import.meta.url));
/** @param {string} name
 * @param {{client?: object, env?: Record<string,string|undefined>, provider?: (url: string, init: object) => Promise<Response>}} options */
export function loadEdge(name, { client, env = {}, provider } = {}) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid handler name');
  let handler;
  const effects = { network: 0, mail: 0 };
  const values = { SUPABASE_URL: 'https://r13.invalid', SUPABASE_SERVICE_ROLE_KEY: 'r13-synthetic-server-key',
    APP_URL: 'https://r13.invalid', CRON_SECRET: 'r13-synthetic-cron', INVOICE_CRON_SECRET: 'r13-synthetic-invoice-cron',
    PAYCHANGU_SECRET_KEY: 'r13-synthetic-payment', PAYCHANGU_WEBHOOK_SECRET: 'r13-synthetic-webhook',
    AI_API_KEY: 'r13-synthetic-ai', ...env };
  const register = fn => { handler = fn; };
  const blockedNetwork = () => { effects.network++; throw new Error('R13 outbound network blocked'); };
  const context = vm.createContext({
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    crypto: webcrypto, atob, btoa, AbortSignal, setTimeout, clearTimeout,
    fetch: provider ?? blockedNetwork,
    console: { log() {}, warn() {}, error() {}, info() {} },
    Deno: { env: { get: key => values[key] }, serve: register, resolveDns: blockedNetwork },
  });
  const cache = new Map();
  function load(path) {
    if (!path.startsWith(root + sep) && !path.startsWith(root)) throw new Error('Import outside Edge source refused');
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path,module);
    const require = specifier => {
      if (/^https:\/\/deno.land\/std@[^/]+\/http\/server.ts$/.test(specifier)) return { serve: register };
      if (['npm:@supabase/supabase-js@2','https://esm.sh/@supabase/supabase-js@2'].includes(specifier)) return { createClient: () => client };
      if (specifier === 'npm:zod@4.4.3') return zod;
      if (specifier === 'npm:@sentry/deno@8') return { init() {}, setUser() {}, captureException() {} };
      if (specifier === 'npm:nodemailer@6.9.14') return { createTransport: () => ({ sendMail: () => { effects.mail++; throw new Error('R13 email disabled'); } }) };
      if (specifier === 'npm:jszip@3.10.1') return class { constructor() { throw new Error('R13 export generation unavailable'); } };
      if (specifier.startsWith('.')) return load(resolve(dirname(path),specifier));
      throw new Error('Unapproved Edge import (specifier omitted)');
    };
    const code = ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText;
    new vm.Script(`(function(require,module,exports){${code}\n})`,{filename:path}).runInContext(context,{timeout:5000})(require,module,module.exports);
    return module.exports;
  }
  load(resolve(root,name,'index.ts'));
  if (!handler) throw new Error('Handler registration not captured');
  return { invoke: request => handler(request), effects };
}

/** @param {{user?: object|null, resolveQuery?: (call: {table:string, filters:unknown[][], operation:string, values:unknown}) => {data:unknown,error:unknown}, resolveRpc?: (name:string,args:unknown) => {data:unknown,error:unknown}}} options */
export function mockClient({ user = null, resolveQuery = () => ({ data: null, error: null }), resolveRpc = () => ({ data: null, error: null }) } = {}) {
  const calls = [];
  const authUpdates = [];
  return {
    calls, authUpdates,
    auth: {
      getUser: async () => ({ data: { user }, error: user ? null : { message: 'Synthetic invalid session' } }),
      admin: { updateUserById: async (id, attrs) => { authUpdates.push({ id, fields: Object.keys(attrs) }); return { data: { user }, error: null }; },
        getUserById: async id => ({ data: { user: { id, email: '265990000001@phone.ledgr.app', last_sign_in_at: '2026-01-01T00:00:00Z' } }, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
    from(table) {
      const call = { table, filters: [], operation: 'select', values: null };
      const chain = new Proxy({}, { get(_target, prop) {
        if (prop === 'then') return (yes, no) => {
          calls.push(call); return Promise.resolve(resolveQuery(call)).then(yes,no);
        };
        return (...args) => {
          if (['insert','update','delete','upsert'].includes(prop)) { call.operation=prop; call.values=args[0]; }
          else if (['eq','in','is'].includes(prop)) call.filters.push([prop,...args]);
          return chain;
        };
      } });
      return chain;
    },
    async rpc(name,args) { calls.push({ rpc:name,args }); return resolveRpc(name,args); },
  };
}
