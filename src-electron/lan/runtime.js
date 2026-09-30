// Shared, in-memory state for the network feature (one per app process).
export const lan = {
  mode: 'single', // 'single' | 'host' | 'client'
  config: null,
  key: '',
  server: null,
  serverError: '',
  stopEvents: null,
  clientConnected: false,
};

/** Connection details for talking to the main PC (client mode). */
export function clientEndpoint(version) {
  const c = lan.config || {};
  return { address: c.hostAddress, port: c.port, key: lan.key, version };
}
