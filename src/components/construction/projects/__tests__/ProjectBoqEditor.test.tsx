// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';
import { ProjectBoqEditor } from '../ProjectBoqEditor';
const mock = vi.hoisted(() => ({ getBoqLines: vi.fn(), getBoqSummary: vi.fn(), bulkUpsertBoqLines: vi.fn() }));
vi.mock('@/lib/repositories', () => ({ repos: { projects: mock } }));
const project = { id:'p1', business_id:'b1', name:'Project', client_name:'Client', contract_sum:200, retention_pct:0, budget:200, status:'active' as const, start_date:null, end_date:null, created_by:'u1', created_at:'', updated_at:'', boq_locked_at:null };
function mount(canManage=true) { const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}); return render(<QueryClientProvider client={client}><ProjectBoqEditor project={project} canManage={canManage} onNotice={vi.fn()} /></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); void i18n.changeLanguage('en'); mock.getBoqLines.mockResolvedValue([
 {id:'l1',project_id:'p1',line_number:'2',description:'Second',quantity:2,unit:'m',rate:10,total_value:20,sort_order:1,created_at:'',updated_at:''},
 {id:'l0',project_id:'p1',line_number:'1',description:'First',quantity:1,unit:'ea',rate:30,total_value:30,sort_order:0,created_at:'',updated_at:''},
 ]); mock.getBoqSummary.mockResolvedValue({total_boq_value:50,contract_sum:200,variance:150,line_count:2,is_locked:false}); mock.bulkUpsertBoqLines.mockResolvedValue([]); });
afterEach(cleanup);
describe('ProjectBoqEditor', () => {
 it('renders by sort order and edits and saves the batch payload', async () => {
   mount();
   const first = await screen.findByDisplayValue('First');
   const second = screen.getByDisplayValue('Second');
   expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
   fireEvent.change(first,{target:{value:'Updated'}});
   fireEvent.click(screen.getByRole('button',{name:'Save BOQ'}));
   await waitFor(() => expect(mock.bulkUpsertBoqLines).toHaveBeenCalled());
   expect(mock.bulkUpsertBoqLines).toHaveBeenCalledWith('p1', expect.arrayContaining([expect.objectContaining({id:'l0',description:'Updated',sort_order:0}),expect.objectContaining({id:'l1',sort_order:1})]));
 });
 it('shows a variance warning in under-budget yellow and allows adding a line', async () => {
   mock.getBoqLines.mockResolvedValue([]);
   mount();
   expect(await screen.findByText(/does not match contract sum/)).toBeTruthy();
   expect(screen.getByText('Variance').parentElement?.className).toContain('bg-yellow-50');
   fireEvent.click(screen.getByRole('button',{name:'Add Line'}));
   expect(screen.getByRole('button',{name:'Save BOQ'})).toBeTruthy();
 });
 it('marks a confirmed removal in the batch save payload', async () => {
   vi.spyOn(window, 'confirm').mockReturnValue(true);
   mount();
   await screen.findByDisplayValue('First');
   fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
   fireEvent.click(screen.getByRole('button', { name: 'Save BOQ' }));
   await waitFor(() => expect(mock.bulkUpsertBoqLines).toHaveBeenCalled());
   expect(mock.bulkUpsertBoqLines).toHaveBeenCalledWith('p1', expect.arrayContaining([expect.objectContaining({ id: 'l0', _deleted: true })]));
 });
 it('renders a locked BOQ read-only with its banner', async () => {
   mock.getBoqSummary.mockResolvedValue({total_boq_value:50,contract_sum:200,variance:150,line_count:2,is_locked:true});
   mount();
   expect(await screen.findByText(/This BOQ is locked because a valuation has been created/)).toBeTruthy();
   expect(screen.queryByRole('button',{name:'Add Line'})).toBeNull();
   expect((screen.getByDisplayValue('First') as HTMLInputElement).disabled).toBe(true);
 });
 it('renders the empty state when the project has no lines', async () => {
   mock.getBoqLines.mockResolvedValue([]);
   mock.getBoqSummary.mockResolvedValue({total_boq_value:0,contract_sum:0,variance:0,line_count:0,is_locked:false});
   mount();
   expect(await screen.findByText('Add your first BOQ line to define the schedule of values for this project.')).toBeTruthy();
 });
});
