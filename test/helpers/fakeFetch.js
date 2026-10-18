// -----------------------------------------------------------------------------
// A fake `fetch` for the P1 Monitor client: routes by path (without the
// query), records every call, fails loudly on an unexpected one. No test
// touches the network.
// -----------------------------------------------------------------------------

/**
 * `routes` maps a path ("/api/v1/smartmeter") to
 * handler({ url, path, query, init }) -> Response, or throws.
 */
export function createFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    const call = { url, path: pathname, query: search, init, headers: init.headers ?? {} };
    calls.push(call);
    const handler = routes[pathname];
    if (!handler) {
      throw new Error(`Unexpected P1 Monitor call in a test: ${pathname}`);
    }
    return handler(call);
  };
  return { fetch: fetchImpl, calls, routes };
}

/** What fetch throws when the device does not answer in time. */
export const timeoutError = () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};

/** What fetch throws when nothing listens at the address. */
export const refusedError = () => {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  return err;
};
