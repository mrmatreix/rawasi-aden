/**
 * One-time production database import (Railway volume bootstrap).
 *
 * Runs ONLY when: NODE_ENV=production, PRODUCTION_IMPORT_TOKEN is set (>= 32 chars),
 * and the database file at RAWASI_DB_PATH does not exist yet. Otherwise it exits 0
 * immediately and the normal server starts.
 *
 * While running it serves nothing but:
 *   GET  /api/health, /api/ready       -> 200 {"importMode": true}  (Railway healthcheck)
 *   PUT  /__production-import          -> raw SQLite file body
 *        headers: X-Import-Token (must match), X-Content-SHA256 (hex of the body)
 * The upload is size-limited, SHA-256 verified, written to a temp file on the volume,
 * checked with PRAGMA integrity_check, then atomically renamed into place.
 * After a successful import the process exits 0 and the container's CMD starts the
 * normal server. Remove PRODUCTION_IMPORT_TOKEN afterwards.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = process.env.RAWASI_DB_PATH;
const token = process.env.PRODUCTION_IMPORT_TOKEN || '';
const MAX_BYTES = 200 * 1024 * 1024;

if (process.env.NODE_ENV !== 'production' || token.length < 32 || !dbPath) process.exit(0);
if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
  console.log('[import] Database already present; import mode skipped.');
  process.exit(0);
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const sameToken = value => {
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

let done = false;
const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && (url === '/api/health' || url === '/api/ready')) return json(res, 200, { success: true, importMode: true });
  if (req.method !== 'PUT' || url !== '/__production-import') return json(res, 404, { success: false, message: 'Import mode: not available' });
  if (done) return json(res, 409, { success: false, message: 'Already imported' });
  if (!sameToken(req.headers['x-import-token'])) { req.resume(); return json(res, 403, { success: false, message: 'Forbidden' }); }
  const expected = String(req.headers['x-content-sha256'] || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) { req.resume(); return json(res, 400, { success: false, message: 'X-Content-SHA256 required' }); }

  const chunks = []; let size = 0; let aborted = false;
  req.on('data', c => { size += c.length; if (size > MAX_BYTES) { aborted = true; req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const actual = crypto.createHash('sha256').update(body).digest('hex');
    if (actual !== expected) return json(res, 400, { success: false, message: 'SHA-256 mismatch', actual });
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.import-${process.pid}.db`);
    try {
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(tmp);
      const integrity = db.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]);
      const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
      db.close();
      if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error('integrity_check failed: ' + integrity.slice(0, 3).join('; '));
      if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) throw new Error('database appeared during import; refusing to overwrite');
      fs.renameSync(tmp, dbPath);
      done = true;
      console.log(`[import] Imported database (${body.length} bytes, sha256 ${actual}, ${users} staff users).`);
      json(res, 200, { success: true, bytes: body.length, sha256: actual, users });
      setTimeout(() => server.close(() => process.exit(0)), 500);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      console.error('[import] Failed:', err.message);
      json(res, 500, { success: false, message: err.message });
    }
  });
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('[import] Waiting for one-time production database upload.'));
