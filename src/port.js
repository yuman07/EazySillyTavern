'use strict';

const net = require('node:net');

const MIN = 49152;
const MAX = 65535;
const MAX_RANGE_RETRIES = 5;

// Pick one port via listen(0). server.address() can throw on Windows when
// winsock buffers are exhausted (ENOBUFS) — observed in the wild on machines
// with aggressive security software. A throw inside the listen callback is
// NOT caught by the surrounding `new Promise(...)` executor (the throw
// happens on a later tick, in an event-emitter callback), so leaving it
// unguarded turns a recoverable network hiccup into an uncaughtException
// that crashes the launcher. Catch it ourselves and route through reject.
function pickPortOnce() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let port;
      try {
        port = server.address().port;
      } catch (err) {
        server.close(() => reject(err));
        return;
      }
      server.close((closeErr) => {
        if (closeErr) return reject(closeErr);
        resolve(port);
      });
    });
  });
}

// SPEC §七-2: prefer the IANA dynamic range (49152-65535), but accept any
// free port the OS hands out as a fallback. On a small minority of Windows
// machines (custom dynamic port range, winsock filters from security software)
// listen(0) consistently returns ports outside the dynamic range; rejecting
// in that case bricks the launcher even though the chosen port is functionally
// fine — we only ever bind 127.0.0.1 and re-pick on every launch, so the high
// vs. low distinction is hygiene, not correctness.
async function pickEphemeralPort() {
  let fallbackPort = null;
  let lastErr = null;
  for (let i = 0; i < MAX_RANGE_RETRIES; i++) {
    let port;
    try {
      port = await pickPortOnce();
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (port >= MIN && port <= MAX) return port;
    fallbackPort = port;
  }
  if (fallbackPort != null) return fallbackPort;
  throw lastErr ?? new Error('Failed to allocate an ephemeral port');
}

module.exports = { pickEphemeralPort };
