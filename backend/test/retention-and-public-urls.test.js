'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createUserSystem } = require('../user-system');
const { pickPublicBaseUrl } = require('../plugin-runtime/media');

function createSystem() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-retention-test-'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT)');
  const system = createUserSystem({ db, dataDir });
  system.initSchema();
  return {
    db,
    system,
    close() {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('public base URLs accept multiple entries, dedupe, and keep legacy field compatible', () => {
  const { system, close } = createSystem();
  try {
    const defaults = system.getSettings();
    assert.deepEqual(defaults.publicBaseUrls, []);
    assert.equal(defaults.publicBaseUrl, '');
    assert.equal(defaults.auditRetentionDays, 180);
    assert.equal(defaults.usageRetentionDays, 365);

    const updated = system.updateSettings({
      publicBaseUrls: [
        'http://192.168.31.88:3030/',
        'https://nova.example.com/',
        'HTTP://192.168.31.88:3030',
      ],
    });
    assert.deepEqual(updated.publicBaseUrls, [
      'http://192.168.31.88:3030',
      'https://nova.example.com',
    ]);
    assert.equal(updated.publicBaseUrl, 'http://192.168.31.88:3030');

    const legacy = system.updateSettings({ publicBaseUrl: 'http://legacy.local:8080/' });
    assert.deepEqual(legacy.publicBaseUrls, ['http://legacy.local:8080']);
    assert.equal(legacy.publicBaseUrl, 'http://legacy.local:8080');

    assert.throws(
      () => system.updateSettings({ publicBaseUrls: ['ftp://invalid.example.com'] }),
      /http:\/\/ 或 https:\/\//,
    );
    assert.deepEqual(system.getSettings().publicBaseUrls, ['http://legacy.local:8080']);
  } finally {
    close();
  }
});

test('retention cleanup removes old audit and usage rows but keeps recent ones', () => {
  const { db, system, close } = createSystem();
  try {
    system.updateSettings({ auditRetentionDays: 30, usageRetentionDays: 90 });
    system.audit({ id: 'admin', username: 'admin' }, 'test.old', '');
    system.audit({ id: 'admin', username: 'admin' }, 'test.new', '');
    system.recordUsage({ userId: 'u1', kind: 'image', taskId: 'old-task' });
    system.recordUsage({ userId: 'u1', kind: 'image', taskId: 'new-task' });

    const oldIso = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const oldAudit = db.prepare('SELECT id FROM audit_logs ORDER BY id ASC LIMIT 1').get();
    const oldUsage = db.prepare('SELECT id FROM usage_events ORDER BY id ASC LIMIT 1').get();
    db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run(oldIso, oldAudit.id);
    db.prepare('UPDATE usage_events SET created_at = ? WHERE id = ?').run(oldIso, oldUsage.id);

    const removed = system.cleanupRetention();
    assert.deepEqual(removed, { audit: 1, usage: 1 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, 1);
    assert.equal(db.prepare('SELECT action FROM audit_logs').get().action, 'test.new');
    assert.equal(db.prepare('SELECT task_id FROM usage_events').get().task_id, 'new-task');
  } finally {
    close();
  }
});

test('zero retention days means keep forever', () => {
  const { db, system, close } = createSystem();
  try {
    system.updateSettings({ auditRetentionDays: 0, usageRetentionDays: 0 });
    system.audit({ id: 'admin', username: 'admin' }, 'test.keep', '');
    system.recordUsage({ userId: 'u1', kind: 'text', taskId: 'keep-task' });
    const oldIso = new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE audit_logs SET created_at = ?').run(oldIso);
    db.prepare('UPDATE usage_events SET created_at = ?').run(oldIso);

    const removed = system.cleanupRetention();
    assert.deepEqual(removed, { audit: 0, usage: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, 1);
  } finally {
    close();
  }
});

test('public base URL selection prefers the configured URL matching the request host', () => {
  const configured = ['http://192.168.31.88:3030', 'https://nova.example.com'];
  assert.equal(
    pickPublicBaseUrl(configured, { headers: { host: '192.168.31.88:3030' } }),
    'http://192.168.31.88:3030',
  );
  assert.equal(
    pickPublicBaseUrl(configured, {
      headers: { 'x-forwarded-host': 'nova.example.com', 'x-forwarded-proto': 'https' },
    }),
    'https://nova.example.com',
  );
  assert.equal(
    pickPublicBaseUrl(configured, { headers: { host: 'unknown.local:3030' } }),
    configured[0],
  );
  assert.equal(pickPublicBaseUrl([], { headers: { host: '192.168.31.88:3030' } }), 'http://192.168.31.88:3030');
});
