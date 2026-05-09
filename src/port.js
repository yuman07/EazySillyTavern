'use strict';

const net = require('node:net');

// Ask the OS for an unused port via listen(0) and return whatever it hands
// out. We don't constrain to the IANA dynamic range (49152-65535) — only
// 127.0.0.1 is bound and the port is re-picked on every launch, so the
// "high port" preference is hygiene without material benefit, and some
// Windows machines (custom dynamic port range, winsock filters from security
// software) consistently return lower ports.
//
// Catch the throw from `server.address()` ourselves: on Windows it can fail
// with ENOBUFS when winsock buffers are exhausted, and a throw inside the
// listen callback is NOT caught by the surrounding `new Promise(...)` (the
// throw fires on a later tick from an event-emitter callback), so leaving it
// unguarded turned a recoverable network hiccup into an uncaughtException
// that crashed the launcher.
function pickEphemeralPort() {
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

module.exports = { pickEphemeralPort };
