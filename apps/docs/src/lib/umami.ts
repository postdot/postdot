/**
 * Umami analytics. The scripts are copied to `/p.js` and `/r.js` at build time
 * (`scripts/sync-umami.ts`), so they are first-party. Both values are public;
 * `vite.config.ts` reads them from `POSTBOT_UMAMI_ID` and `POSTBOT_UMAMI_URL`.
 */
export const umamiId = import.meta.env.VITE_UMAMI_ID ?? ''
export const umamiUrl = import.meta.env.VITE_UMAMI_URL ?? ''
export const umamiEnabled = Boolean(umamiId && umamiUrl)
