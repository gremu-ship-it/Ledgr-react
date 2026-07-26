import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const url = Deno.env.get('SUPABASE_URL')!;
function key(name:string, fallback:string){const raw=Deno.env.get(name);if(!raw)return fallback;try{const parsed=JSON.parse(raw);if(typeof parsed==='string')return parsed; if(parsed.default)return parsed.default; const first=Object.values(parsed)[0]; return typeof first==='string'?first:fallback}catch{return raw}}
const publishable=key('SUPABASE_PUBLISHABLE_KEYS',Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY')??'');
const secret=key('SUPABASE_SECRET_KEYS',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??Deno.env.get('SUPABASE_SECRET_KEY')??'');
export const admin=createClient(url,secret);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS'};
const client=(req:Request)=>createClient(url,publishable,{global:{headers:{Authorization:req.headers.get('Authorization')??'',apikey:publishable}}});
export async function user(req:Request){const {data,error}=await client(req).auth.getUser();if(error||!data.user)throw new Error('Unauthorized');return data.user}
export function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}})}
export function preflight(req:Request){return req.method==='OPTIONS'?new Response('ok',{headers:cors}):null}
export function sessionId(req:Request){const t=(req.headers.get('Authorization')??'').replace(/^Bearer\s+/i,'');try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id??null}catch{return null}}
export function requireSessionId(req:Request){const id=sessionId(req);if(!id)throw new Error('Session identifier missing');return id}
