import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type'};
serve(async req => { if(req.method==='OPTIONS') return new Response('ok',{headers:cors}); try {
 const auth=req.headers.get('Authorization')||''; const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}}); const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('Unauthorised');
 const {invoiceId,to,html,pdfBase64}=await req.json(); if(!invoiceId||!to) throw new Error('invoiceId and recipient email are required');
 const key=Deno.env.get('SENDGRID_API_KEY'); if(!key) throw new Error('SENDGRID_API_KEY is not configured'); const tracking=`${Deno.env.get('SUPABASE_URL')}/functions/v1/invoice-open?invoice=${invoiceId}`;
 const body={personalizations:[{to:[{email:to}]}],from:{email:Deno.env.get('SENDGRID_FROM_EMAIL')||'invoices@ledgr.app',name:'Ledgr'},subject:'Your Ledgr invoice',content:[{type:'text/html',value:`${html||'<p>Please find your invoice attached.</p>'}<img src="${tracking}" width="1" height="1" alt=""/>`}],attachments:pdfBase64?[{content:pdfBase64,filename:'invoice.pdf',type:'application/pdf',disposition:'attachment'}]:undefined};
 const res=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)}); if(!res.ok) throw new Error(`SendGrid rejected email (${res.status})`);
 await db.from('invoices').update({status:'sent',sent_at:new Date().toISOString()} as never).eq('id',invoiceId); await db.from('invoice_delivery_events').insert({invoice_id:invoiceId,business_id:(await db.from('invoices').select('business_id').eq('id',invoiceId).single()).data?.business_id,event_type:'sent'} as never);
 return new Response(JSON.stringify({ok:true}),{headers:{...cors,'content-type':'application/json'}});
 } catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'Unable to send'}),{status:400,headers:{...cors,'content-type':'application/json'}})}});
