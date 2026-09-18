/** A follow-up adapter prepares data; the host owns review, permission, idempotency and result state. */
export function defineCapability(implementation) {
  for (const name of ['preview', 'execute']) {
    if (typeof implementation?.[name] !== 'function') throw new TypeError(`capability.${name} is required`);
  }
  return Object.freeze({ ...implementation });
}

/** Call adapters provide transport outcomes; only the host evaluates mission completion. */
export function defineCallCapability(implementation) {
  if(typeof implementation?.execute !== 'function')throw new TypeError('call.execute is required');
  return Object.freeze({...implementation});
}
