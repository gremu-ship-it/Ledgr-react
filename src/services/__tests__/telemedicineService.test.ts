import { beforeEach, describe, expect, it, vi } from 'vitest';

const hc = vi.hoisted(() => ({
  handlers: new Map<string, (operation: string, values: unknown) => { data?: unknown; error?: unknown }>(),
  calls: [] as Array<{ table: string; operation: string; values: unknown }>,
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: unknown = null;

    const resolve = () => {
      hc.calls.push({ table, operation, values });
      const handler = hc.handlers.get(table);
      return handler ? handler(operation, values) : { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;

    Object.assign(builder, {
      select: passthrough,
      insert: (input: unknown) => {
        operation = 'insert';
        values = input;
        return builder;
      },
      update: (input: unknown) => {
        operation = 'update';
        values = input;
        return builder;
      },
      upsert: (input: unknown) => {
        operation = 'upsert';
        values = input;
        return builder;
      },
      delete: () => {
        operation = 'delete';
        return builder;
      },
      eq: passthrough,
      neq: passthrough,
      in: passthrough,
      ilike: passthrough,
      like: passthrough,
      or: passthrough,
      is: passthrough,
      not: passthrough,
      order: passthrough,
      limit: passthrough,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    });

    return builder;
  };

  return { supabase: { from: makeBuilder } };
});

import {
  buildSmsInviteUrl,
  buildTelemedicineInviteMessage,
  buildTelemedicineRoomUrl,
  buildWhatsAppInviteUrl,
  ensureTelemedicineMeeting,
  hashRoomSegment,
  markTelemedicineLinkSent,
  saveTelemedicineNotes,
  startTelemedicineCall,
  telemedicineRoomName,
} from '../telemedicineService';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';
const PATIENT = {
  id: '22222222-2222-4222-8222-222222222222',
  business_id: BUSINESS_ID,
  mrn: 'PAT-2026-0001',
  first_name: 'Jane',
  last_name: 'Banda',
  billing_type: 'cash',
  phone: '+265 991 000 111',
};

beforeEach(() => {
  hc.handlers.clear();
  hc.calls.length = 0;
});

describe('telemedicine room URLs', () => {
  it('hashes the business + visit into a stable, URL-safe room name', () => {
    const first = buildTelemedicineRoomUrl(BUSINESS_ID, VISIT_ID);
    const second = buildTelemedicineRoomUrl(BUSINESS_ID, VISIT_ID);
    const other = buildTelemedicineRoomUrl(BUSINESS_ID, '99999999-9999-4999-8999-999999999999');

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(
      /^https:\/\/meet\.jit\.si\/Ledgr-[a-z0-9]+-[a-z0-9]+#config\.prejoinPageEnabled=false$/,
    );
    expect(first).not.toContain(BUSINESS_ID);
    expect(first).not.toContain(VISIT_ID);
    expect(telemedicineRoomName(first)).toMatch(/^Ledgr-/);
    expect(hashRoomSegment(BUSINESS_ID)).toBe(hashRoomSegment(BUSINESS_ID));
  });
});

describe('WhatsApp + SMS dispatch', () => {
  const meetingUrl = buildTelemedicineRoomUrl(BUSINESS_ID, VISIT_ID);

  it('URI-encodes the invite text and normalises the phone number', () => {
    const url = buildWhatsAppInviteUrl({
      phone: '+265 991 000 111',
      patientName: 'Jane Banda',
      doctorName: 'Dr Phiri',
      meetingUrl,
    });

    expect(url.startsWith('https://wa.me/265991000111?text=')).toBe(true);
    expect(url).not.toContain('#config.prejoinPageEnabled=false');
    const parsed = new URL(url);
    const text = parsed.searchParams.get('text') ?? '';
    expect(text).toContain('Jane Banda');
    expect(text).toContain('Dr Phiri');
    expect(text).toContain(meetingUrl);
    expect(text).toBe(
      buildTelemedicineInviteMessage({
        patientName: 'Jane Banda',
        doctorName: 'Dr Phiri',
        meetingUrl,
      }),
    );
  });

  it('builds a native SMS composer URL with the same encoded body', () => {
    const url = buildSmsInviteUrl({
      phone: '0991 000 111',
      patientName: 'Jane Banda',
      meetingUrl,
    });

    expect(url.startsWith('sms:0991000111?body=')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toContain(meetingUrl);
  });

  it('still produces a WhatsApp URL for a patient without a phone number', () => {
    const url = buildWhatsAppInviteUrl({
      phone: null,
      patientName: 'Jane Banda',
      meetingUrl,
    });
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
  });
});

describe('virtual waiting room', () => {
  it('provisions a Jitsi room when the visit does not have one yet', async () => {
    hc.handlers.set('patient_visits', (operation, values) => {
      if (operation === 'select') {
        return {
          data: {
            id: VISIT_ID,
            business_id: BUSINESS_ID,
            visit_number: 'VST-2026-0001',
            visit_type: 'telemedicine',
            stage: 'triaged',
            meeting_url: null,
            telemedicine_status: 'waiting',
            patient: PATIENT,
          },
          error: null,
        };
      }
      return {
        data: {
          id: VISIT_ID,
          business_id: BUSINESS_ID,
          visit_number: 'VST-2026-0001',
          visit_type: (values as { visit_type?: string }).visit_type,
          stage: 'triaged',
          meeting_url: (values as { meeting_url?: string }).meeting_url,
          telemedicine_status: 'waiting',
          patient: PATIENT,
        },
        error: null,
      };
    });

    const visit = await ensureTelemedicineMeeting(BUSINESS_ID, VISIT_ID);

    expect(visit.meeting_url).toBe(buildTelemedicineRoomUrl(BUSINESS_ID, VISIT_ID));
    const update = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      visit_type: 'telemedicine',
      telemedicine_status: 'waiting',
    });
  });

  it('marks the invite link as sent and starts the call', async () => {
    hc.handlers.set('patient_visits', (_operation, values) => ({
      data: {
        id: VISIT_ID,
        business_id: BUSINESS_ID,
        visit_number: 'VST-2026-0001',
        visit_type: 'telemedicine',
        stage: 'triaged',
        meeting_url: 'https://meet.jit.si/Ledgr-abc-def',
        telemedicine_status: (values as { telemedicine_status?: string }).telemedicine_status,
        patient: PATIENT,
      },
      error: null,
    }));

    await markTelemedicineLinkSent(BUSINESS_ID, VISIT_ID);
    await startTelemedicineCall(BUSINESS_ID, VISIT_ID);

    const updates = hc.calls.filter(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(updates[0]?.values).toMatchObject({ telemedicine_status: 'link_sent' });
    expect(updates[1]?.values).toMatchObject({ telemedicine_status: 'in_call' });
    expect((updates[1]?.values as { telemedicine_started_at: string }).telemedicine_started_at).toBeTruthy();
  });

  it("persists the doctor's split-screen notes", async () => {
    hc.handlers.set('patient_visits', (_operation, values) => ({
      data: {
        id: VISIT_ID,
        business_id: BUSINESS_ID,
        telemedicine_notes: (values as { telemedicine_notes?: string }).telemedicine_notes,
        patient: PATIENT,
      },
      error: null,
    }));

    const visit = await saveTelemedicineNotes(BUSINESS_ID, VISIT_ID, 'Cough for 4 days, no fever.');

    expect(visit.telemedicine_notes).toBe('Cough for 4 days, no fever.');
    const update = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(update?.values).toEqual({ telemedicine_notes: 'Cough for 4 days, no fever.' });
  });
});
