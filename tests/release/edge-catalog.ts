/** Explicit handler contracts; route presence alone is not authentication evidence. */
export const edgeCatalog = [
  ['accept-invite-link','authenticated','R02'], ['ai-chat','organisation-restricted','R11'],
  ['api','webhook/service-to-service','R12'], ['cancel-account-deletion','authenticated','R14'],
  ['create-api-key','role-restricted','R12'], ['create-invite-link','role-restricted','R02'],
  ['expire-subscriptions','server-only','R10'], ['export-my-data','authenticated','R14'],
  ['finalize-account-deletions','server-only','R14'], ['generate-partner-invoices','server-only','R14'],
  ['generate-vat-returns','server-only','R14'], ['grant-manual-subscription','role-restricted','R10'],
  ['initiate-subscription-payment','role-restricted','R10'], ['invite-team-member','role-restricted','R02'],
  ['invoice-open','public/anonymous by design','R14'], ['list-team-members','organisation-restricted','R04'],
  ['paychangu-webhook','webhook/service-to-service','R10'], ['process-invoice-automation','server-only','R14'],
  ['request-account-deletion','authenticated','R14'], ['retry-failed-webhooks','server-only','R12'],
  ['send-invoice','organisation-restricted','R04'], ['send-renewal-reminders','server-only','R14'],
  ['suggest-bank-matches','authenticated','R11'], ['support-agent','authenticated','R11'],
  ['verify-subscription-payment','organisation-restricted','R10'], ['webhook-dispatcher','organisation-restricted','R12'],
] as const;
