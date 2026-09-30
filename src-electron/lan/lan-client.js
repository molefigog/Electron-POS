// Runs on the OTHER PCs: talks to the main PC's LAN server.
// Pure Node (no Electron imports) so it can be tested on its own.

export class LanError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function headers(ep) {
  return { 'Content-Type': 'application/json', 'x-pos-key': ep.key, 'x-pos-version': ep.version || '' };
}

const base = (ep) => `http://${ep.address}:${ep.port}`;

async function request(ep, method, path, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(base(ep) + path, {
      method,
      headers: headers(ep),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LanError(
      err?.name === 'AbortError'
        ? 'The main PC did not answer in time. Check the network and try again.'
        : `Cannot reach the main PC at ${ep.address}. Make sure it is switched on, the POS is open there, and both PCs use the same router.`,
      err?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE',
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (res.status === 401) throw new LanError(data?.error || 'Wrong access key.', 'UNAUTHORIZED');
  if (res.status === 409) throw new LanError(data?.error || 'Version mismatch.', 'VERSION_MISMATCH');
  if (!res.ok || !data) throw new LanError(data?.error || `The main PC returned an error (${res.status}).`, 'BAD_RESPONSE');
  return data;
}

/** Sends a call to the main PC. Application errors are re-thrown as plain Errors, like a local call would. */
export async function remoteCall(ep, path, payload) {
  const data = await request(ep, 'POST', path, payload);
  if (!data.ok) throw new Error(data.error || 'Operation failed');
  return data.result;
}

/** Checks reachability, access key and version. Resolves details, or throws a LanError. */
export async function pingHost(ep) {
  const started = Date.now();
  const res = await request(ep, 'GET', '/ping', undefined, 5000);
  if (res.app !== 'nid-pos') throw new LanError('Something answered, but it is not the POS main PC.', 'BAD_RESPONSE');
  if (!res.authorized) throw new LanError('Wrong access key. Copy the connection code again from the main PC.', 'UNAUTHORIZED');
  if (res.version !== ep.version) {
    throw new LanError(
      `This PC runs version ${ep.version} but the main PC runs ${res.version}. Install the same version on every PC.`,
      'VERSION_MISMATCH',
    );
  }
  return { ms: Date.now() - started, hostName: res.name || '', hostVersion: res.version };
}

/**
 * Listens for "data changed" announcements from the main PC and reconnects
 * automatically. Returns a stop() function.
 */
export function subscribeToChanges(ep, { onChange, onStatus } = {}) {
  let stopped = false;
  let controller = null;

  async function loop() {
    while (!stopped) {
      controller = new AbortController();
      let watchdog = null;
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), 45000); // server sends a heartbeat every 15 s
      };
      try {
        arm();
        const res = await fetch(`${base(ep)}/events`, { headers: headers(ep), signal: controller.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        onStatus?.(true);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          arm();
          buffer += decoder.decode(chunk, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = block.split('\n').find((l) => l.startsWith('data:'));
            if (line) {
              try {
                onChange?.(JSON.parse(line.slice(5).trim()));
              } catch {
                /* ignore malformed event */
              }
            }
          }
        }
      } catch {
        /* fall through to reconnect */
      } finally {
        clearTimeout(watchdog);
      }
      if (stopped) break;
      onStatus?.(false);
      await sleep(3000);
    }
  }

  loop();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
