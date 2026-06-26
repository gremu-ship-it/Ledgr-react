import { supabase } from './supabase';

import { BusinessRepository } from '@/dal/repositories/BusinessRepository';
import { JournalRepository } from '@/dal/repositories/JournalRepository';
import { InvoiceRepository } from '@/dal/repositories/InvoiceRepository';
import { ExpenseRepository } from '@/dal/repositories/ExpenseRepository';
import { PayrollRepository } from '@/dal/repositories/PayrollRepository';
import { TaxRepository } from '@/dal/repositories/TaxRepository';
import { AccountRepository } from '@/dal/repositories/AccountRepository';
import { AssetRepository } from '@/dal/repositories/AssetRepository';
import { InventoryRepository } from '@/dal/repositories/InventoryRepository';
import { IncomeRepository } from '@/dal/repositories/IncomeRepository';
import { ContactRepository } from '@/dal/repositories/ContactRepository';

export const repos = {
  business: new BusinessRepository(supabase),
  journal: new JournalRepository(supabase),
  invoice: new InvoiceRepository(supabase),
  expense: new ExpenseRepository(supabase),
  payroll: new PayrollRepository(supabase),
  tax: new TaxRepository(supabase),
  account: new AccountRepository(supabase),
  asset: new AssetRepository(supabase),
  inventory: new InventoryRepository(supabase),
  income: new IncomeRepository(supabase),
  contact:    new ContactRepository(supabase),
};

export type Repositories = typeof repos;