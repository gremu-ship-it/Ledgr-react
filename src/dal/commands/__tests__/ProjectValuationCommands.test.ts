import { describe, expect, it, vi } from 'vitest';
import {
  CreateValuationCommand,
  GenerateInvoiceCommand,
  ReleaseRetentionCommand,
  SubmitValuationCommand,
  UpdateValuationCommand,
} from '../ProjectValuationCommands';

const input = {
  valuation_date: '2026-10-17',
  period_start: '2026-10-01',
  period_end: '2026-10-17',
  lines: [{ boq_line_id: 'boq1', cumulative_pct: 42.5, notes: null }],
  notes: null,
};
const document = { valuation: { id: 'v1', valuation_number: 1 }, lines: [], invoice: null, retention_entries: [] };

describe('construction valuation commands', () => {
  it('delegates user valuation intent to the repository', async () => {
    const createValuation = vi.fn().mockResolvedValue(document);
    const updateValuation = vi.fn().mockResolvedValue(document);
    const submitValuation = vi.fn().mockResolvedValue(document);
    const generateInvoice = vi.fn().mockResolvedValue(document);
    const releaseRetention = vi.fn().mockResolvedValue({ retention_entry: {}, invoice: {} });

    await expect(new CreateValuationCommand({ createValuation }).execute('p1', input)).resolves.toEqual(document);
    await expect(new UpdateValuationCommand({ updateValuation }).execute('v1', input)).resolves.toEqual(document);
    await expect(new SubmitValuationCommand({ submitValuation }).execute('v1')).resolves.toEqual(document);
    await expect(new GenerateInvoiceCommand({ generateInvoice }).execute('v1')).resolves.toEqual(document);
    await expect(new ReleaseRetentionCommand({ releaseRetention }).execute('p1', 10, 'Completion')).resolves.toEqual({
      retention_entry: {}, invoice: {},
    });

    expect(createValuation).toHaveBeenCalledWith('p1', input);
    expect(updateValuation).toHaveBeenCalledWith('v1', input);
    expect(submitValuation).toHaveBeenCalledWith('v1');
    expect(generateInvoice).toHaveBeenCalledWith('v1');
    expect(releaseRetention).toHaveBeenCalledWith('p1', 10, 'Completion');
  });
});
