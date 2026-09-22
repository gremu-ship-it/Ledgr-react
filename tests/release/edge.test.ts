import { expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { loadEdge, mockClient } from './edge-loader.mjs';
import { edgeCatalog } from './edge-catalog';
import { evidenceSuite, Blocked } from './evidence';
import { identities, key } from './fixtures';
const test = evidenceSuite('edge-handler-mocked-platform');
const meta = (id: string, expected: string, handler: string, remediation: string) => ({
  id, expected, source: `supabase/functions/${handler}/index.ts`, remediation,
  layer: 'unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway',
});
test({id:'EDGE.CATALOG',expected:'All 26 source handlers classified',source:'tests/release/edge-catalog.ts',remediation:'R13'}, () => {
  expect(edgeCatalog.map(x=>x[0]).sort()).toEqual(readdirSync('supabase/functions',{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith('_')).map(e=>e.name).sort());
});
for (const [name,classification,owner] of edgeCatalog) {
  for (const mode of ['missing','invalid']) test(meta(`EDGE.${name}.${mode}`, `${classification}: reject ${mode} credential before privileged business data/effects; public pixel stays inert`,name,owner), async () => {
    const client = mockClient({ resolveRpc: (rpc: string) => ({data: rpc==='consume_api_rate_limit' ? true : null,error:null}) });
    const edge=loadEdge(name,{client});
    const path=name==='api'?'/api/v1/invoices':name==='invoice-open'&&mode==='invalid'?`?invoice=${key(701)}&token=r13-invalid`:'';
    const request=new Request(`https://r13.invalid/functions/v1/${name}${path}`, {
      method:name==='invoice-open'?'GET':'POST',
      headers: mode==='invalid'?{Authorization:'Bearer r13-invalid', 'x-api-key':'r13-invalid','x-cron-secret':'r13-invalid','Signature':'r13-invalid','Content-Type':'application/json'}:{'Content-Type':'application/json'},
      ...(name==='invoice-open'?{}:{body:JSON.stringify({business_id:key(201),name:'R13 fixture',role:'viewer',email:'r13@example.invalid',phone:'+265990000001',token:'r13-invalid',invoice_id:key(701),tx_ref:'r13-payment',target_plan_tier:'growth',billing_cycle:'monthly',event:'invoice.paid',payload:{id:key(701)},messages:[{role:'user',content:'R13 synthetic request'}],bankLines:[],ledgerEntries:[]})}),
    });
    const response=await edge.invoke(request);
    if (name==='invoice-open') expect(response.status).toBe(200);
    else expect(response.status).toBe(401);
    // API may consume a rate bucket and inspect a key hash, but must not touch business records.
    expect(client.calls.filter((c: {table?: string;rpc?: string}) => c.table !== 'api_keys' && c.rpc !== 'consume_api_rate_limit')).toHaveLength(0);
    expect(client.authUpdates).toHaveLength(0);
    expect(edge.effects).toEqual({network:0,mail:0});
  });
}
for(const [org,other] of [['A','B'],['B','A']]) test(meta(`EDGE.AI.${org}-to-${other}`, 'A valid caller cannot select a foreign business even with forged frontend context','ai-chat','R11'), async()=>{
  const business=key(org==='A'?201:202);
  const client=mockClient({user:{id:identities[`${org}_viewer`].id},resolveQuery:(c:{table:string})=>({data:c.table==='business_users'?[{business_id:business,role:'viewer',businesses:{id:business,name:'R13',deleted_at:null}}]:null,error:null})});
  const edge=loadEdge('ai-chat',{client});
  const r=await edge.invoke(new Request('https://r13.invalid/ai',{method:'POST',headers:{Authorization:'Bearer r13-synthetic'},body:JSON.stringify({messages:[{role:'user',content:'R13 context request'}],context:{companyId:key(other==='A'?201:202)}})}));
  expect(r.status).toBe(403);expect(client.calls.filter((c:{rpc?:string})=>c.rpc==='ai_context')).toHaveLength(0);expect(edge.effects.network).toBe(0);
});
test(meta('EDGE.MANUAL-GRANT.viewer','Authenticated non-platform-admin is denied manual subscription grant','grant-manual-subscription','R01'),async()=>{
  const client=mockClient({user:{id:identities.A_viewer.id},resolveQuery:()=>({data:{is_platform_admin:false},error:null})});
  const edge=loadEdge('grant-manual-subscription',{client});
  const r=await edge.invoke(new Request('https://r13.invalid/grant',{method:'POST',headers:{Authorization:'Bearer r13-synthetic'},body:'{}'}));
  expect(r.status).toBe(403);expect(client.calls.filter((c:{operation?:string})=>c.operation&&c.operation!=='select')).toHaveLength(0);
});
test(meta('EDGE.RETRY.no-secret','Absent job configuration must reject even explicitly empty secret header','retry-failed-webhooks','R12/R14'),async()=>{
  const client=mockClient({resolveQuery:()=>({data:[],error:null})});
  const edge=loadEdge('retry-failed-webhooks',{client,env:{CRON_SECRET:undefined,INVOICE_CRON_SECRET:undefined}});
  const r=await edge.invoke(new Request('https://r13.invalid/retry',{method:'POST',headers:{'x-cron-secret':''}}));
  expect(r.status).toBe(401);expect(client.calls).toHaveLength(0);
});
for (const id of ['AUTH.valid-login','AUTH.invalid-login','AUTH.expired-session','AUTH.logout-revocation']) test({
  id,expected:'Real Auth service validates login/expiry/session revocation with synthetic identities',
  source:'src/lib/supabase.ts',remediation:'R01/R02',layer:'Supabase Auth platform (unavailable)',
},()=>{throw new Blocked('No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence.');});
for (const [id,name,owner,reason] of [
  ['PRIV.RECOVERY','invite-team-member','R02','Global recovery authority and verified phone proof require isolated Auth Admin + approved recovery contract.'],
  ['PRIV.INVITATION','accept-invite-link','R02','Real identity evidence, invitation lifecycle and profile-phone fallback need isolated Auth and DB integration.'],
  ['AI.BRANCH','ai-chat','R11','Durable branch assignment and field-permission contract require design approval.'],
]) test(meta(id,reason,name,owner),()=>{throw new Blocked(reason);});

test(meta('EDGE.RECOVERY.foreign-identity','An Org A owner cannot reset a global Org B phone identity without recovery authority','invite-team-member','R02'),async()=>{
  const client=mockClient({user:{id:identities.A_owner.id},resolveQuery:(c:{table:string;filters:unknown[][]})=>{
    if(c.table==='business_users') {
      const caller=c.filters.some(f=>f[1]==='user_id'&&f[2]===identities.A_owner.id);
      return {data:caller?{role:'owner',is_active:true}:null,error:null};
    }
    if(c.table==='phone_accounts') return {data:{user_id:identities.B_viewer.id},error:null};
    return {data:null,error:null};
  }});
  const edge=loadEdge('invite-team-member',{client});
  await edge.invoke(new Request('https://r13.invalid/invite',{method:'POST',headers:{Authorization:'Bearer r13-synthetic'},body:JSON.stringify({business_id:key(201),phone:'+265990000001',role:'viewer',reset_password:true})}));
  expect(client.authUpdates).toHaveLength(0);
});

test(meta('EDGE.WEBHOOK.viewer','Viewer cannot emit authoritative arbitrary financial event payload','webhook-dispatcher','R12'),async()=>{
  const client=mockClient({user:{id:identities.A_viewer.id},resolveQuery:(c:{table:string})=>({data:c.table==='business_users'?{id:key(1)}:[],error:null})});
  const edge=loadEdge('webhook-dispatcher',{client});
  const r=await edge.invoke(new Request('https://r13.invalid/webhook',{method:'POST',headers:{Authorization:'Bearer r13-synthetic'},body:JSON.stringify({business_id:key(201),event:'invoice.paid',payload:{id:key(501),amount:999999}})}));
  expect(r.status).toBe(403);expect(edge.effects.network).toBe(0);
});


test(meta('EDGE.AI.owner-normal','Valid owner request builds own business context and returns provider response through isolated provider adapter','ai-chat','R11'),async()=>{
  const business=key(201);let providerCalls=0;
  const client=mockClient({user:{id:identities.A_owner.id},resolveQuery:(c:{table:string})=>({data:c.table==='business_users'?[{business_id:business,role:'owner',businesses:{id:business,name:'R13 A',deleted_at:null}}]:null,error:null}),
    resolveRpc:(name:string)=>({data:name==='ai_context'?{company:{id:business,name:'R13 A'},kpis:{},monthlyTrend:[],overdueInvoices:[],topExpenses:[],topCustomers:[],upcomingReceivables:[],upcomingPayables:[],anomalies:[]}:null,error:null})});
  const edge=loadEdge('ai-chat',{client,provider:async()=>{providerCalls++;return new Response(JSON.stringify({choices:[{message:{content:'R13 synthetic advice'}}]}),{status:200});}});
  const r=await edge.invoke(new Request('https://r13.invalid/ai',{method:'POST',headers:{Authorization:'Bearer r13-synthetic'},body:JSON.stringify({messages:[{role:'user',content:'R13 advice'}],context:{companyId:business}})}));
  expect(r.status).toBe(200);expect(providerCalls).toBe(1);expect(edge.effects.network).toBe(0);
  expect(client.calls.filter((c:{rpc?:string})=>c.rpc==='ai_context')).toHaveLength(1);
});
