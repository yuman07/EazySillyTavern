'use strict';

const net = require('node:net');

const MIN = 49152;
const MAX = 65535;

function pickEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) return reject(err);
        if (port < MIN || port > MAX) {
          // OS handed out a low port; that is fine functionally but
          // SPEC says use the dynamic range — rare, so just retry once.
          return pickEphemeralPort().then(resolve, reject);
        }
        resolve(port);
      });
    });
  });
}

module.exports = { pickEphemeralPort };
