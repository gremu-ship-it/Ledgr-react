import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ALLOWED_ROLES = new Set(['owner','admin','accountant','payroll_manager','supervisor','data_entry','inventory_manager','sales_clerk','auditor','viewer']);
const ROLE_ALIASES: Record<string,string> = { staff:'accountant', sales:'sales_clerk' };
function normalizeRole(input:string){ const lower=(input||'').trim().toLowerCase(); const mapped=ROLE_ALIASES[lower]??lower; return ALLOWED_ROLES.has(mapped)?mapped:null; }
function generateToken(){ const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); }
serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS_HEADERS});
  if(req.method!=='POST') return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  try{
    const authHeader=req.headers.get('Authorization'); if(!authHeader) return new Response(JSON.stringify({error:'Missing Authorization'}),{status:401,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const callerClient=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
    const {data:callerData,error:callerErr}=await callerClient.auth.getUser(); if(callerErr||!callerData?.user) return new Response(JSON.stringify({error:'Invalid session'}),{status:401,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const callerId=callerData.user.id; const body=await req.json().catch(()=>({})); const businessId=(body.business_id||'').trim(); const rawRole=(body.role||'').trim(); const emailRaw=(body.email||'').trim().toLowerCase()||null; const origin=(body.origin||'').trim()||null;
    if(!businessId) return new Response(JSON.stringify({error:'business_id required'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const role=normalizeRole(rawRole); if(!role) return new Response(JSON.stringify({error:`Invalid role ${rawRole}`}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const {data:callerMembership}=await admin.from('business_users').select('role').eq('business_id',businessId).eq('user_id',callerId).eq('is_active',true).maybeSingle();
    if(!callerMembership) return new Response(JSON.stringify({error:'You are not a member of this business'}),{status:403,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const callerRole=(callerMembership as any).role as string; if((role==='owner'&&callerRole!=='owner')||(role==='admin'&&callerRole!=='owner')) return new Response(JSON.stringify({error:`Only owners can invite as ${role}`}),{status:403,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    if(!['owner','admin'].includes(callerRole)) return new Response(JSON.stringify({error:'Only owners and admins can create invite links'}),{status:403,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const token=generateToken(); const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
    const {data:biz,error:bizErr}=await admin.from('businesses').select('name').eq('id',businessId).maybeSingle(); if(bizErr||!biz) return new Response(JSON.stringify({error:'Business not found'}),{status:404,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const {error:insertErr}=await admin.from('business_invitations').insert({business_id:businessId,email:emailRaw,role,token,invited_by:callerId,expires_at:expiresAt}); if(insertErr) return new Response(JSON.stringify({error:`Failed: ${insertErr.message}`}),{status:500,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    const baseUrl=origin||Deno.env.get('APP_URL')||''; const inviteUrl=baseUrl?`${baseUrl.replace(/\/$/,'')}/accept-invitation?token=${token}`:`/accept-invitation?token=${token}`;
    return new Response(JSON.stringify({success:true,token,invite_url:inviteUrl,business_id:businessId,business_name:(biz as any).name,role,email:emailRaw,expires_at:expiresAt}),{status:200,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  }catch(err){ return new Response(JSON.stringify({error:(err as Error).message}),{status:500,headers:{...CORS_HEADERS,'Content-Type':'application/json'}}); }
});
