// @vitest-environment jsdom
/**
 * R07 — Client approval boundary, remediated (the false-approval attack now
 * fails permanently).
 *
 * The pre-release version of this file CHARACTERIZED the attack: a fabricated
 * 4-plus-character PIN and a free-text approver name "authorized" a void or
 * refund from the browser. Those tests were built to turn red the moment the
 * containment release landed — and they did. This file now pins the boundary
 * in its contained state so any reintroduction of browser-trusted authority
 * turns RED instead:
 *
 *   1. The modal has no PIN field and no free-text approver field at all.
 *   2. In server mode it only REQUESTS an approval (via the injected callback
 *      wired to `request_pos_approval`) and forwards the server-minted token.
 *   3. The page's approval handler can only transport a token — there is no
 *      client-supplied approver identity anywhere in the correction payloads.
 *   4. The service layer routes voids/refunds through the canonical commands
 *      and has no raw-DML fallback outside the offline demo simulator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PosManagerApprovalModal } from '../PosManagerApprovalModal';

afterEach(cleanup);

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('R07 approval boundary — contained state', () => {
  it('server mode requests an approval and forwards only the server-minted token', async () => {
    const onApprove = vi.fn();
    const requestFn = vi.fn().mockResolvedValue('11111111-2222-3333-4444-555555555555');
    render(
      <PosManagerApprovalModal
        open
        onClose={() => {}}
        actionDescription="Void sale INV-0001"
        onRequestServerApproval={requestFn}
        onApprove={onApprove}
      />,
    );
    // No PIN input exists anywhere in the remediated boundary.
    expect(screen.queryByPlaceholderText('••••')).toBeNull();
    expect(screen.queryByText(/PIN/i)).toBeNull();
    fireEvent.click(screen.getByText('Request approval'));
    await waitFor(() => screen.getByText(/Approval requested and recorded on the server/));
    expect(requestFn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Continue with this approval'));
    expect(onApprove).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555');
  });

  it('display mode cannot fabricate an authorization: no pin, no typed approver, token undefined', () => {
    const onApprove = vi.fn();
    render(
      <PosManagerApprovalModal
        open
        onClose={() => {}}
        actionDescription="Apply 30% discount (exceeds 10% cap)"
        onApprove={onApprove}
      />,
    );
    expect(screen.queryByText(/PIN/i)).toBeNull();
    expect(screen.queryByDisplayValue('Store Manager')).toBeNull();
    fireEvent.click(screen.getByText('Confirm on the till'));
    expect(onApprove).toHaveBeenCalledWith(undefined);
  });

  it('ATTACK GUARD: no browser input anywhere in the modal can impersonate an approver', () => {
    const src = read('src/components/pos/PosManagerApprovalModal.tsx');
    expect(src).not.toMatch(/password/i);
    // No pin-shaped identifier or state anywhere in the component's CODE
    // (the comments recount the removed anti-pattern on purpose).
    const codeOnly = src.replace(/\/\*[^]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(codeOnly).not.toMatch(/setPin|managerPin|pinValue|pinInput|\bpin\b/i);
    expect(codeOnly).not.toMatch(/approverName/);
    expect(codeOnly).not.toMatch(/managerName/);
    const inputs = src.match(/<input/g) ?? [];
    expect(inputs.length).toBe(0);
  });

  it('ATTACK GUARD: PosPage transports only the token into the correction payloads and mints approvals server-side', () => {
    const src = read('src/pages/PosPage.tsx');
    expect(src).not.toMatch(/approverName/);
    expect(src).toContain('requestPosApproval(');
    const payloadBlock = src.match(/processReturn\(\{([^]*?)\}\);/)?.[1] ?? '';
    expect(payloadBlock).toContain('approvalToken');
    expect(payloadBlock).not.toMatch(/approverName/);
    const voidBlock = src.match(/processVoid\(\{([^]*?)\}\);/)?.[1] ?? '';
    expect(voidBlock).toContain('approvalToken');
  });

  it('ATTACK GUARD: the service layer has exactly one correction path — the canonical commands; raw-DML bodies are demo-only', () => {
    const src = read('src/services/posService.ts');
    expect(src).toContain('voidPosSaleViaRpc(');
    expect(src).toContain('refundPosSaleViaRpc(');
    // The legacy raw-DML materializers are private and gated behind isDemoMode().
    expect(src).toMatch(/async function processVoidLocal\(/);
    expect(src).toMatch(/async function processReturnLocal\(/);
    const routerBlock = src.match(/export async function processVoid\(([^]*?)\n}\n/)?.[0] ?? '';
    expect(routerBlock).toContain('isDemoMode()');
    expect(routerBlock).toContain('voidPosSaleViaRpc({');
    expect(routerBlock).not.toContain('repos.invoice.update');
    // The correction payloads carry no approver identity anywhere.
    const types = read('src/types/pos.ts');
    const returnPayload = types.match(/export interface PosReturnPayload \{([^]*?)\n\}/)?.[1] ?? '';
    const voidPayload = types.match(/export interface PosVoidPayload \{([^]*?)\n\}/)?.[1] ?? '';
    expect(returnPayload).not.toMatch(/approver/i);
    expect(voidPayload).not.toMatch(/approver/i);
  });
});
