import Papa from 'papaparse';

export interface BankTransaction {
  date: string;
  description: string;
  amount: number;
  reference?: string;
  type: 'debit' | 'credit';
}

export async function parseBankStatement(file: File, bankFormat: string): Promise<BankTransaction[]> {
  const text = await file.text();
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    return parseCSV(text, bankFormat);
  }
  if (ext === 'ofx') {
    return parseOFX(text);
  }
  if (ext === 'mt940') {
    return parseMT940(text);
  }
  throw new Error('Unsupported file format');
}

function parseCSV(text: string, bankFormat: string): BankTransaction[] {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });

  return (data as any[]).map((row) => {
    const date = row.date || row.Date || row['Transaction Date'] || '';
    const desc = row.description || row.Description || row.Narrative || '';
    const amount = parseFloat(row.amount || row.Amount || row['Transaction Amount'] || '0');
    const ref = row.reference || row.Reference || row['Cheque No'] || '';

    return {
      date,
      description: desc,
      amount: Math.abs(amount),
      reference: ref,
      type: amount < 0 ? 'debit' : 'credit',
    };
  }).filter(t => t.date && t.description);
}

function parseOFX(text: string): BankTransaction[] {
  // Simple OFX parser (real implementation would use a library)
  const transactions: BankTransaction[] = [];
  const regex = /<STMTTRN>[\s\S]*?<DTPOSTED>(\d{8})[\s\S]*?<TRNAMT>(-?[\d.]+)[\s\S]*?<NAME>([^<]+)[\s\S]*?<\/STMTTRN>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    transactions.push({
      date: `${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`,
      description: match[3].trim(),
      amount: Math.abs(parseFloat(match[2])),
      type: parseFloat(match[2]) < 0 ? 'debit' : 'credit',
    });
  }
  return transactions;
}

function parseMT940(text: string): BankTransaction[] {
  const lines = text.split('\n');
  const transactions: BankTransaction[] = [];
  let current: Partial<BankTransaction> = {};

  for (const line of lines) {
    if (line.startsWith(':20:')) current = {};
    if (line.startsWith(':25:')) current.reference = line.split(':')[2]?.trim();
    if (line.startsWith(':60F:') || line.startsWith(':62F:')) {
      // opening/closing balance lines
    }
    if (line.startsWith(':61:')) {
      const date = line.substring(4, 10);
      const amount = parseFloat(line.split('C')[1] || line.split('D')[1] || '0');
      current.date = `${date.slice(0,2)}-${date.slice(2,4)}-${date.slice(4,6)}`;
      current.amount = Math.abs(amount);
      current.type = line.includes('C') ? 'credit' : 'debit';
    }
    if (line.startsWith(':86:')) {
      current.description = line.substring(4).trim();
      if (current.date && current.description) {
        transactions.push(current as BankTransaction);
        current = {};
      }
    }
  }
  return transactions;
}