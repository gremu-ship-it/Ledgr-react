// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const aiApi = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: aiApi.invoke } },
}));

import '@/i18n';
import { AiChatConsole } from '@/components/ai/AiChatConsole';
import { LedgrAiChatDrawer } from '@/components/ai/LedgrAiChatDrawer';
import { useAppStore } from '@/store/useAppStore';

function renderDrawer(route = '/manufacturing/costing') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LedgrAiChatDrawer isOpen onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  aiApi.invoke.mockReset();
  aiApi.invoke.mockResolvedValue({ data: { content: 'Edge answer', actionUrl: '/reports', actionLabel: 'View Reports' }, error: null });
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: { id: 'business-1', name: 'Ledger Ltd', base_currency: 'MWK', plan_tier: 'enterprise' },
    },
  } as never);
});

afterEach(() => cleanup());

describe('LedgrAiChatDrawer', () => {
  it('renders route-specific chips and a disabled send button until text is entered', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'Ledgr AI Assistant' })).toBeTruthy();
    expect(screen.getByText('How to calculate direct labor and BOM overhead?')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByPlaceholderText('Ask Ledgr AI about finances, BOM costing, construction, POS...') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Explain markup' } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits a question, shows the answer and exposes its navigation action', async () => {
    renderDrawer();
    const input = screen.getByPlaceholderText('Ask Ledgr AI about finances, BOM costing, construction, POS...');
    fireEvent.change(input, { target: { value: 'Explain markup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(aiApi.invoke).toHaveBeenCalled());
    expect(await screen.findByText('Edge answer')).toBeTruthy();
    expect(screen.getByRole('button', { name: /View Reports/ })).toBeTruthy();
  });

  it('clears the conversation back to the welcome message', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Conversation' }));
    await waitFor(() => {
      expect(aiApi.invoke).not.toHaveBeenCalled();
      expect(screen.getByText(/Hello! I am your/)).toBeTruthy();
    });
  });
});

describe('AiChatConsole', () => {
  it('renders an embedded chat with chips for the active route', () => {
    render(
      <MemoryRouter initialEntries={['/pos']}>
        <AiChatConsole />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Conversational AI Workspace' })).toBeTruthy();
    expect(screen.getByText('How do I set up 80mm thermal receipt printing?')).toBeTruthy();
  });
});
