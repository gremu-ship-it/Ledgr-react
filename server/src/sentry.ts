/**
 * Sentry initialization for ESM modules.
 * 
 * This file must be loaded BEFORE the main application using the --import flag:
 *   node --import ./dist/sentry.js dist/index.js
 * 
 * This ensures Sentry can properly instrument Express and other modules
 * before they are loaded by the application.
 */

import * as Sentry from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.APP_ENV || 'development',
    
    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // Error filtering
    beforeSend(event) {
      // Filter out health check errors (too noisy)
      if (event.request?.url?.includes('/api/health')) {
        return null;
      }
      return event;
    },
    
    // Integrations
    integrations: [
      // Enable Express integration for automatic error capturing
      Sentry.expressIntegration(),
      // Enable HTTP integration for request tracking
      Sentry.httpIntegration(),
    ],
  });

  console.log('[Sentry] Initialized successfully');
} else {
  console.log('[Sentry] DSN not configured, skipping initialization');
}
