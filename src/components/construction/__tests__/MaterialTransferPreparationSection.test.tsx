// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MaterialTransferPreparationSection } from '@/components/construction/MaterialTransferPreparationSection';
import type {
  LocalMaterialTransferPreparation,
  MaterialTransferPreparationFields,
  MaterialTransferPreparationStage,
} from '@/lib/construction/materialTransferPreparation';

type SaveHandler = (
  fields: MaterialTransferPreparationFields,
  localId: number | undefined,
  stage: MaterialTransferPreparationStage,
) => number | null;

function RetryHarness({ onSave }: { onSave: SaveHandler }) {
  const [preparations, setPreparations] = useState<LocalMaterialTransferPreparation[]>([]);

  function save(
    fields: MaterialTransferPreparationFields,
    localId: number | undefined,
    stage: MaterialTransferPreparationStage,
  ): number | null {
    const savedLocalId = onSave(fields, localId, stage);
    if (savedLocalId === null) return null;

    const now = new Date().toISOString();
    setPreparations((current) => [{
      ...fields,
      localId: savedLocalId,
      projectLocalId: 1,
      businessId: 'business-current',
      stage,
      createdAt: now,
      updatedAt: now,
    }, ...current.filter((preparation) => preparation.localId !== savedLocalId)]);
    return savedLocalId;
  }

  return (
    <MaterialTransferPreparationSection
      projectLocalId={1}
      businessId="business-current"
      projectName="North site job"
      projectCode="JOB-1"
      siteName="North site"
      siteLocation="Blantyre"
      preparations={preparations}
      onSave={save}
      onDiscard={() => setPreparations([])}
    />
  );
}

const otherBusinessPreparation: LocalMaterialTransferPreparation = {
  transferReferenceNote: 'OTHER-BUSINESS-SECRET',
  sourceDocumentReference: '',
  transferDate: '',
  sourceStoreNote: 'Other store',
  destinationSiteNote: 'Other site',
  dispatchDate: '',
  dispatchNote: '',
  receiptDate: '',
  receiptNote: '',
  lines: [{
    lineLocalKey: 1,
    materialDescription: 'Other material',
    itemCodeNote: '',
    unitNote: 'unit',
    quantityRequested: '1',
    quantityDispatched: '',
    quantityReceived: '',
    exceptionNote: '',
  }],
  localId: 9,
  projectLocalId: 44,
  businessId: 'business-other',
  stage: 'prepared',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
};

afterEach(cleanup);

describe('MaterialTransferPreparationSection', () => {
  it('keeps preparations scoped to the exact local project and business context', () => {
    render(
      <MaterialTransferPreparationSection
        projectLocalId={44}
        businessId="business-current"
        projectName="Current project"
        projectCode="P-44"
        siteName="Current site"
        siteLocation="Blantyre"
        preparations={[otherBusinessPreparation]}
        onSave={() => 1}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText('No store-to-site transfer preparations for this local project in this tab.')).toBeTruthy();
    expect(screen.queryByText('OTHER-BUSINESS-SECRET')).toBeNull();
  });

  it('reports an unavailable local context and allows an explicit retry', async () => {
    const onSave = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(7);
    render(<RetryHarness onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare transfer note' }));
    fireEvent.change(screen.getByLabelText('Transfer reference note'), { target: { value: 'TR-RETRY' } });
    fireEvent.change(screen.getByLabelText('Source store or location note'), { target: { value: 'Main store note' } });
    fireEvent.change(screen.getByLabelText('Material description'), { target: { value: 'Cement' } });
    fireEvent.change(screen.getByLabelText('Unit note'), { target: { value: 'bag' } });
    fireEvent.change(screen.getByLabelText('Requested quantity'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));
    expect(await screen.findByText(/local project context is no longer available/i)).toBeTruthy();
    expect(screen.getByLabelText('Transfer reference note')).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));
    expect(await screen.findByRole('heading', { name: 'TR-RETRY' })).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][1]).toBeUndefined();
    expect(onSave.mock.calls[1][2]).toBe('prepared');
  });
});
