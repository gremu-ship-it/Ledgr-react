export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
} as const;

/** JSON response for cron, webhook and other non-browser Edge entry points. */
export function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/** Redirect response that must not be retained by browsers or intermediaries. */
export function noStoreRedirect(location: string, status: 302 | 303 | 307 | 308 = 302): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Location: location,
    },
  });
}
