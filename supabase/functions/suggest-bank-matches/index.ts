import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const token = req.headers.get('Authorization');
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: token || '' } } });
    const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error('Unauthorised');
    const { bankLines, ledgerEntries } = await req.json();
    if (!Array.isArray(bankLines) || !Array.isArray(ledgerEntries)) throw new Error('bankLines and ledgerEntries are required');
    // Only send the minimum transaction data to the AI provider; never account numbers or user details.
    const prompt = `Match Malawi bank statement lines to Ledgr journal entries. Match only when amount is exact, date is within 3 days, and payee/reference supports it. Return JSON only: {"matches":[{"bankIndex":0,"entryId":"id","confidence":0-1,"reason":"short"}]}. Bank lines: ${JSON.stringify(bankLines.map((x: any, i: number) => ({ i, date:x.date, amount:x.amount, type:x.type, description:x.description, reference:x.reference })))}. Entries: ${JSON.stringify(ledgerEntries.map((x: any) => ({ id:x.id, date:x.entry_date, amount:x.amount, description:x.description, reference:x.reference })))}.`;
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type':'application/json', 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version':'2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }) });
    if (!response.ok) throw new Error(`Claude matching request failed (${response.status})`);
    const payload = await response.json(); const text = payload.content?.find((x: any) => x.type === 'text')?.text || '{"matches":[]}';
    const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    return new Response(JSON.stringify(json), { headers: { ...cors, 'content-type':'application/json' } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to suggest matches' }), { status: 400, headers: { ...cors, 'content-type':'application/json' } }); }
});
