import { setGlobalOptions } from 'firebase-functions/v2';

/**
 * Cost guard applied to every function. Imported first in `index.ts` so it runs
 * before any function module is evaluated.
 *
 * `maxInstances` caps how far a function can scale out, so a client bug or abuse
 * script can't fan out into an unbounded bill. Requests over the cap queue/retry
 * instead of spawning more instances. Per-function options still override this.
 */
setGlobalOptions({ maxInstances: 10 });
