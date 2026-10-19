const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const rootDir = path.resolve(__dirname, '../..');
const env = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProd = env === 'production';
const isStaging = env === 'staging';
let legacy = {};
if (!isProd && !isStaging) {
  const file = path.join(rootDir, 'server/database/config.json');
  if (fs.existsSync(file)) legacy = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
const resolve = value => path.resolve(rootDir, value);
const dataDir = process.env.RAWASI_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const persistent = dataDir ? resolve(dataDir) : null;
const dbPath = resolve(process.env.RAWASI_DB_PATH || (isStaging ? 'server/database/rawasi_aden_staging.db' : persistent ? path.join(persistent, 'rawasi_aden.db') : legacy.dbPath || 'server/database/rawasi_aden.db'));
const engine = (process.env.DB_ENGINE || (isProd ? '' : legacy.dbEngine) || 'sqlite').toLowerCase();
if (!['sqlite', 'mysql'].includes(engine)) throw new Error('DB_ENGINE must be sqlite or mysql');
const oldMysql = legacy.mysql || {};
const mysql = { ...oldMysql, host: process.env.MYSQL_HOST || oldMysql.host || 'localhost', port: Number(process.env.MYSQL_PORT || oldMysql.port || 3306), user: process.env.MYSQL_USER || oldMysql.user || 'root', password: process.env.MYSQL_PASSWORD ?? oldMysql.password ?? '', database: process.env.MYSQL_DATABASE || oldMysql.database || 'rawasi_aden', connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10) };
if (!/^[a-zA-Z0-9_]+$/.test(mysql.database)) throw new Error('Invalid MySQL database name');
const storage = {
  data: persistent,
  uploads: resolve(process.env.RAWASI_UPLOAD_DIR || (persistent ? path.join(persistent, 'uploads') : 'uploads')),
  projects: resolve(process.env.RAWASI_PROJECTS_DIR || (persistent ? path.join(persistent, 'projects') : 'ملفات_المشاريع')),
  backups: resolve(process.env.RAWASI_BACKUP_DIR || (persistent ? path.join(persistent, 'backups') : 'server/database/backups')),
  scratch: resolve(process.env.RAWASI_SCRATCH_DIR || (persistent ? path.join(persistent, 'scratch') : 'scratch'))
};
function contained(base, candidate) { const rel = path.relative(base, candidate); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
const compromisedSecretHashes = new Set(["2b73c4d48bdaa5206d9ef7c2cb3845b45b8053997a9954dea7a694cf244a0779","a2e2c6d39256558d87093a173438db32957025ed8a5aa1def0f8be81f9656cf7","179bf5e5a7d3b47ed87291ba5f51b728479fcf34fc729da215ceebfec90bd5bc"]);
const developmentSecrets = new Map();
function secret(name, minimum = 32) {
  const value = process.env[name];
  if (value && compromisedSecretHashes.has(crypto.createHash('sha256').update(value).digest('hex')) && (isProd||isStaging)) throw new Error(name + ' is a known published legacy key; rotate it before deployment');
  if (value && value.length >= minimum && !/^(?:change[-_ ]?me|example|replace[-_ ])/i.test(value)) return value;
  if (isProd || isStaging) throw new Error(name + ' must be explicitly set to a strong secret of at least ' + minimum + ' characters');
  // Local sessions keep working across development restarts; never commit this file.
  const secretFile = path.join(rootDir, 'server/database/.development-secrets.json');
  if (!developmentSecrets.size) {
    let saved = {};
    if (fs.existsSync(secretFile)) saved = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    for (const key of ['JWT_SECRET', 'CLIENT_JWT_SECRET']) developmentSecrets.set(key, saved[key] || crypto.randomBytes(48).toString('base64url'));
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, JSON.stringify(Object.fromEntries(developmentSecrets)), { mode: 0o600 });
  }
  if (!developmentSecrets.has(name)) throw new Error(name + ' must be configured explicitly');
  return developmentSecrets.get(name);
}
function validateProduction() {
  if (!isProd && !isStaging) return;
  for (const key of ['JWT_SECRET', 'CLIENT_JWT_SECRET', 'BANK_ENCRYPTION_KEY']) secret(key);
  if (secret('JWT_SECRET') === secret('CLIENT_JWT_SECRET')) throw new Error('Staff and client JWT secrets must be different');
  if (!process.env.DB_ENGINE) throw new Error('Set DB_ENGINE explicitly');
  if (!persistent || !fs.existsSync(persistent)) throw new Error('Mount persistent storage and set RAWASI_DATA_DIR');
  for (const candidate of [dbPath, storage.uploads, storage.projects, storage.backups, storage.scratch]) {
    if (!contained(persistent, candidate) || contained(rootDir, candidate)) throw new Error('Production data must be on the persistent volume, outside the application directory');
  }
  if (engine === 'sqlite' && (!fs.existsSync(dbPath) || fs.statSync(dbPath).size < 512)) throw new Error('Existing SQLite database required on volume; automatic production seeding is disabled');
  if (engine === 'sqlite' && Number(process.env.WEB_CONCURRENCY || process.env.RAWASI_WORKERS || 1) !== 1) throw new Error('SQLite requires a single service worker');
  for (const directory of [storage.uploads, storage.projects, storage.backups, storage.scratch]) {
    fs.mkdirSync(directory, { recursive: true }); fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  }
}
let version = require('../../package.json').version;
module.exports = { env, isProd, isStaging, isDev: !isProd && !isStaging, rootDir, port: Number(process.env.PORT || (isStaging ? 3001 : 3000)), dbPath, database: { dbEngine: engine, dbPath, mysql }, storage, secret, contained, validateProduction, version, appName: 'نظام رواسي عدن للهندسة والمقاولات', allowedOrigins: (process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean), schedulersEnabled: process.env.ENABLE_SCHEDULERS !== 'false', logging: {level:isProd?'warn':'info'} };
