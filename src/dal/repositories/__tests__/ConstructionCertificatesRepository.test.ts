import { describe, expect, it, vi } from 'vitest';
import { ConstructionCertificatesRepository } from '../ConstructionCertificatesRepository';

function repository(rpc = vi.fn(async () => ({ data: 'cert-1', error: null }))) {
  return { repo: new ConstructionCertificatesRepository({ rpc } as never), rpc };
}

describe('ConstructionCertificatesRepository', () => {
  it('calls the create RPC with selected existing valuation and deductions', async () => {
    const { repo, rpc } = repository();
    await expect(repo.create({
      valuationId: 'valuation-1', retentionPercentage: 10,
      advanceRecovery: 100, penaltyDeductions: 25, otherDeductions: 5,
    })).resolves.toBe('cert-1');
    expect(rpc).toHaveBeenCalledWith('create_certificate_from_valuation', {
      p_valuation_id: 'valuation-1', p_retention_percentage: 10,
      p_advance_recovery: 100, p_penalty_deductions: 25, p_other_deductions: 5,
    });
  });

  it('uses separate command RPCs for issue, payment, and cancellation', async () => {
    const { repo, rpc } = repository();
    await repo.issue('cert-1', '2026-12-01');
    await repo.recordPayment('cert-1', 125, '2026-11-30');
    await repo.cancel('cert-1');
    expect(rpc).toHaveBeenNthCalledWith(1, 'issue_payment_certificate', {
      p_certificate_id: 'cert-1', p_payment_due_date: '2026-12-01',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'record_payment_certificate_payment', {
      p_certificate_id: 'cert-1', p_amount: 125, p_paid_date: '2026-11-30',
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'cancel_payment_certificate', { p_certificate_id: 'cert-1' });
  });
});
