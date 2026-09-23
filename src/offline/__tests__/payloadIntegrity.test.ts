import { describe, expect, it } from 'vitest';
import { canonicalPayloadJson, hashQueuePayload, verifyPayloadIntegrity } from '@/offline/payloadIntegrity';
import type { QueueItem } from '@/offline/db';

const sample = () => ({
  invoice: { total_amount: 1500, branch_id: 'b-1', lines_note: null },
  lines: [{ product_id: 'p-1', quantity: 2, flags: ['a', 'b'] }],
  payments: [{ amount: 1500 }],
  total: 1500,
});

describe('R09.3 payload integrity hashing', () => {
  it('is deterministic and independent of object key order', async () => {
    const a = sample();
    const b = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;
    // Rebuild with shuffled top-level/keys.
    const shuffled = Object.fromEntries(Object.entries(b).reverse());
    expect(canonicalPayloadJson(shuffled)).toBe(canonicalPayloadJson(a));
    expect(await hashQueuePayload(shuffled)).toBe(await hashQueuePayload(a));
  });

  it('produces a lowercase hex SHA-256 (64 chars)', async () => {
    expect(await hashQueuePayload(sample())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects any financial edit to the stored payload', async () => {
    const stored = sample();
    const hash = await hashQueuePayload(stored);
    const tampered = sample();
    tampered.lines[0].quantity = 3;
    expect(await hashQueuePayload(tampered)).not.toBe(hash);
    tampered.invoice.total_amount = 3000;
    expect(await hashQueuePayload(tampered)).not.toBe(hash);
  });

  it('verifyPayloadIntegrity: match passes, mismatch fails, hashless (pre-v3) rows pass as unverifiable', async () => {
    const payload = sample();
    const hash = await hashQueuePayload(payload);
    const ok = { payload, payloadHash: hash } as unknown as QueueItem;
    expect(await verifyPayloadIntegrity(ok)).toBe(true);

    const edited = { payload: { ...payload, total: 2 }, payloadHash: hash } as unknown as QueueItem;
    expect(await verifyPayloadIntegrity(edited)).toBe(false);

    const preV3 = { payload, payloadHash: null } as unknown as QueueItem;
    expect(await verifyPayloadIntegrity(preV3)).toBe(true);
  });

  it('drops undefined properties and normalizes non-finite numbers exactly like JSON.stringify', () => {
    expect(canonicalPayloadJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalPayloadJson({ n: Number.NaN })).toBe('{"n":null}');
  });
});
