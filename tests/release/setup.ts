import { vi } from 'vitest';
// Never inherit a developer's live frontend configuration in this harness.
vi.stubEnv('VITE_SUPABASE_URL', 'https://r13.invalid');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'r13-synthetic-public-key');
vi.stubGlobal('fetch', () => { throw new Error('R13 network disabled; use an explicit local test adapter'); });
