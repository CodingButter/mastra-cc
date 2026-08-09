// Throwaway. A tiny static origin.
//
// The planning probe used a data: URL, whose inline script Chrome blocked, so
// nothing was actually proven about injection ordering. Injection-order claims
// need a real http origin, and cross-site frame claims need two DIFFERENT
// sites — different ports on one host are the same site to Chrome, so the
// caller maps fake hostnames onto this server with --host-resolver-rules.

import { createServer } from 'node:http';

export function serve(routes, port = 0) {
  // Requests are recorded here because it is the one vantage point neither the
  // page nor any injected script can influence. A spike asking "did that
  // effect actually leave the page" must not take the page's word for it, and
  // CDP's Network domain only reports the sessions it was enabled on — a
  // worker's request is invisible from the page's session.
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const path = new URL(req.url, 'http://x').pathname;
    const body = routes[path];
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not here');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        hits,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}
