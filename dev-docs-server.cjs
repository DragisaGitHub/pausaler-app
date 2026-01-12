const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'docs');
const port = Number(process.argv[2]) || 5500;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function safeJoin(base, target) {
  const targetPath = path.posix.normalize(target).replace(/^\/+/, '');
  const resolvedPath = path.join(base, targetPath);
  if (!resolvedPath.startsWith(base)) return null;
  return resolvedPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = safeJoin(root, pathname);
  if (!filePath) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { 'Content-Type': type });
    stream.pipe(res);
  });
});

server.listen(port, () => {
  console.log(`Docs server running at http://localhost:${port}/`);
  console.log(`Serving directory: ${root}`);
});
