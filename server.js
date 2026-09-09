'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Keep the platform health check green while the site is down for maintenance.
  if (url.pathname === '/health') {
    return send(res, 200, { 'Content-Type': 'application/json' }, '{"status":"ok"}');
  }

  // Static assets the maintenance page needs.
  const asset = path.basename(url.pathname);
  if (asset === 'desktop.png' || asset === 'mobile.png') {
    const file = path.join(ROOT, asset);
    return fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
      send(res, 200, {
        'Content-Type': TYPES['.png'],
        'Cache-Control': 'public, max-age=300',
      }, data);
    });
  }

  // Every other path serves the maintenance page. 503 + Retry-After is the
  // correct signal for a temporary outage, so crawlers hold their index.
  fs.readFile(path.join(ROOT, 'index.html'), (err, data) => {
    if (err) return send(res, 500, { 'Content-Type': 'text/plain' }, 'Internal error');
    send(res, 503, {
      'Content-Type': TYPES['.html'],
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
    }, data);
  });
});

server.listen(PORT, () => {
  console.log('Maintenance page listening on ' + PORT);
});
