import { QueryClient } from '@tanstack/react-query';
import { createLogger } from '@/lib/logger';
import { pushError } from '@/lib/notifications';

const log = createLogger('QueryClient');

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error, variables) => {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        log.error('Mutation failed (unhandled)', error as Error, {
          variables: JSON.stringify(variables).slice(0, 200),
        });
        pushError('Operation failed', message);
      },
    },
  },
});
