#!/usr/bin/env node
'use strict';

// One-time bootstrap for an explicitly requested, isolated Railway staging database.
// It refuses production and never overwrites an existing database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

if (process.env.NODE_ENV !== 'staging' || process.env.ALLOW_STAGING_DB_INIT !== 'true') {
  throw new Error('Staging database initialization requires NODE_ENV=staging and ALLOW_STAGING_DB_INIT=true');
}

const dataDir = path.resolve(process.env.RAWASI_DATA_DIR || '');
const dbPath = path.resolve(process.env.RAWASI_DB_PATH || '');
if (!dataDir || !dbPath || !dbPath.startsWith(dataDir + path.sep)) {
  throw new Error('RAWASI_DB_PATH must be inside RAWASI_DATA_DIR');
}
if (!process.env.STAGING_INITIAL_ADMIN_PASSWORD || process.env.STAGING_INITIAL_ADMIN_PASSWORD.length < 16) {
  throw new Error('Set STAGING_INITIAL_ADMIN_PASSWORD to a strong temporary password');
}
if (!process.env.STAGING_INITIAL_ADMIN_PIN || !/^\d{6,20}$/.test(process.env.STAGING_INITIAL_ADMIN_PIN)) {
  throw new Error('Set STAGING_INITIAL_ADMIN_PIN to a 6-20 digit temporary PIN');
}

fs.mkdirSync(dataDir, { recursive: true });
if (fs.existsSync(dbPath) && fs.statSync(dbPath).size >= 512) {
  const existing = new DatabaseSync(dbPath);
  const valid = existing.prepare('PRAGMA quick_check').all().every(row => Object.values(row)[0] === 'ok');
  const users = valid ? existing.prepare("SELECT COUNT(*) AS count FROM users").get()?.count : 0;
  existing.close();
  if (!valid || !users) throw new Error('Existing staging database is invalid or incomplete; do not overwrite it automatically');
  console.log('Staging database already initialized; no changes made.');
  process.exit(0);
}

const database = new DatabaseSync(dbPath);
try {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(fs.readFileSync(path.join(__dirname, '../server/database/schema.sql'), 'utf8'));
  database.prepare('INSERT OR IGNORE INTO roles (id, name, display_name, permissions) VALUES (?, ?, ?, ?)')
    .run(1, 'admin', 'Staging Administrator', 'all');
  database.prepare(`INSERT INTO users
    (username, password_hash, full_name, role_id, role, status, permissions, two_factor_pin, two_factor_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('staging-admin', bcrypt.hashSync(process.env.STAGING_INITIAL_ADMIN_PASSWORD, 12), 'Staging Administrator', 1, 'admin', 'active', 'all', process.env.STAGING_INITIAL_ADMIN_PIN, 1);
  database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  database.exec('PRAGMA journal_mode = DELETE;');
  console.log('Initialized a clean, isolated staging database.');
} finally {
  database.close();
}
