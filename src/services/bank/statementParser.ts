import Papa from 'papaparse';

export interface BankTransaction { date: string; description: string; amount: number; reference?: string; type: 'debit' | 'credit'; balance?: number }
export interface ParsedStatement { transactions: BankTransaction[]; openingBalance?: number; closingBalance?: number; source: string }
type CsvRow = Record<string, string | number | null | undefined>;
const clean = (v: unknown) => String(v ?? '').trim();
const key = (row: CsvRow, names: string[]) => { const found = Object.keys(row).find(k => names.includes(k.toLowerCase().replace(/[^a-z]/g, ''))); return found ? clean(row[found]) : ''; };
const money = (value: string) => Number(value.replace(/[\s,]/g, '').replace(/\((.*)\)/, '-$1').replace(/[^0-9.-]/g, '')) || 0;
function date(value: string) { const v = value.trim(); if (/^\d{4}-\d\d-\d\d/.test(v)) return v.slice(0, 10); const m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/); if (!m) return v; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }

/** Parses exports from NBS, FDH, Standard Bank, National Bank, Airtel Money and TNM Mpamba. */
export async function parseBankStatement(file: File, bankFormat = 'auto'): Promise<ParsedStatement> {
  const text = await file.text(); const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'ofx') return parseOFX(text);
  if (ext === 'mt940' || ext === 'sta') return parseMT940(text);
  if (ext !== 'csv') throw new Error('Upload a CSV, OFX, or MT940 statement.');
  return parseCSV(text, bankFormat);
}
function parseCSV(text: string, source: string): ParsedStatement {
  const { data } = Papa.parse<CsvRow>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  const transactions = data.map(row => {
    const transactionDate = date(key(row, ['date','transactiondate','valuedate','postingdate','transdate']));
    const description = key(row, ['description','narrative','details','transactiondetails','particulars','remarks','transactiontype']);
    const debit = money(key(row, ['debit','withdrawal','moneyout','debitamount']));
    const credit = money(key(row, ['credit','deposit','moneyin','creditamount']));
    const raw = money(key(row, ['amount','transactionamount','value']));
    const amount = debit || credit ? (debit || credit) : Math.abs(raw);
    const type: BankTransaction['type'] = debit || raw < 0 ? 'debit' : 'credit';
    return { date: transactionDate, description, amount, type, reference: key(row, ['reference','referenceno','transactionid','chequeno','receiptno','rrn']), balance: money(key(row, ['balance','runningbalance','availablebalance'])) || undefined };
  }).filter(t => t.date && t.description && t.amount > 0);
  if (!transactions.length) throw new Error('No transactions found. Check that the first row contains column headings.');
  return { transactions, source: source === 'auto' ? 'CSV import' : source, closingBalance: transactions.at(-1)?.balance, openingBalance: transactions[0]?.balance ? transactions[0].balance! - (transactions[0].type === 'credit' ? transactions[0].amount : -transactions[0].amount) : undefined };
}
function tag(block: string, name: string) { return block.match(new RegExp(`<${name}>([^<\r\n]+)`, 'i'))?.[1]?.trim() ?? ''; }
function parseOFX(text: string): ParsedStatement {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  const transactions = blocks.map(b => { const raw = money(tag(b, 'TRNAMT')); return { date: `${tag(b, 'DTPOSTED').slice(0, 4)}-${tag(b, 'DTPOSTED').slice(4, 6)}-${tag(b, 'DTPOSTED').slice(6, 8)}`, description: tag(b, 'NAME') || tag(b, 'MEMO') || 'Bank transaction', reference: tag(b, 'FITID') || undefined, amount: Math.abs(raw), type: raw < 0 ? 'debit' as const : 'credit' as const }; }).filter(t => t.date && t.amount);
  return { transactions, source: 'OFX', openingBalance: money(tag(text, 'BALAMT')), closingBalance: money((text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<]+)/i) ?? [])[1] ?? '') };
}
function parseMT940(text: string): ParsedStatement {
  const balance = (marker: string) => { const v = text.match(new RegExp(`:${marker}:([CD])(\\d{6})[A-Z]{3}([0-9,]+)`)); return v ? { amount: money(v[3]), sign: v[1] } : undefined; };
  const chunks = text.split(/(?=:61:)/).slice(1); const transactions: BankTransaction[] = [];
  for (const chunk of chunks) { const line = chunk.split(/\r?\n/)[0]; const m = line.match(/^:61:(\d{6})(?:\d{4})?([CD])(?:R?)([0-9,]+)/); if (!m) continue; const desc = chunk.match(/:86:([\s\S]*?)(?=\r?\n:\d{2}|$)/)?.[1].replace(/\r?\n/g, ' ').trim() || 'Bank transaction'; transactions.push({ date: `20${m[1].slice(0,2)}-${m[1].slice(2,4)}-${m[1].slice(4,6)}`, amount: money(m[3]), type: m[2] === 'D' ? 'debit' : 'credit', description: desc, reference: desc.match(/(?:REF|NONREF|[/])([\w/-]+)/i)?.[1] }); }
  const opening = balance('60[FM]'), closing = balance('62[FM]');
  return { transactions, source: 'MT940', openingBalance: opening ? (opening.sign === 'D' ? -opening.amount : opening.amount) : undefined, closingBalance: closing ? (closing.sign === 'D' ? -closing.amount : closing.amount) : undefined };
}
