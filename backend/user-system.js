'use strict';

/**
 * 多用户与管理员配置中心。
 *
 * 这个模块只做数据与安全，不碰 HTTP：
 *   - 用户 / 会话 / 密码（scrypt）
 *   - 供应商与模型（API Key 用 AES-256-GCM 加密落库）
 *   - 站点设置、默认模型、个人配额
 *   - 用量事件、管理员审计日志
 *   - 插件凭据（同样加密落库）
 *
 * server.js 负责路由与鉴权中间件，本模块提供可测试的纯数据操作。
 */

const {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_COOKIE = 'nova_session';
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_MIN_LENGTH = 8;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/;
const ROLES = new Set(['admin', 'user']);
const USER_STATUSES = new Set(['active', 'disabled']);
const IMAGE_PROTOCOLS = new Set(['google', 'openai', 'grok', 'doubao', 'alibaba-dashscope']);
const TEXT_PROTOCOLS = new Set(['openai-responses', 'openai-chat-completions', 'anthropic-messages', 'google-gemini']);
const PROVIDER_KINDS = new Set(['openai-compatible', 'google', 'anthropic-messages', 'grok', 'doubao', 'alibaba-dashscope']);
const OUTPUT_SIZES = new Set(['512', '1K', '2K', '4K']);
const IMAGE_PRESETS = new Set([
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite-image',
  'antigravity-gemini-image',
  'gpt-image-2',
  'gpt-image-2.6',
  'gpt-image-2.6-pro',
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-image-edit',
  'doubao-seedream',
  'alibaba-qwen-image',
  'alibaba-wan-image',
]);

/** 前端把服务端模型当作「配置完整」的占位 Key。后端只在没有 modelConfigId 时才读它。 */
const SERVER_KEY_SENTINEL = '__nova_server__';

const DEFAULT_MODEL_DEFAULTS = {
  textToImage: '',
  imageToImage: '',
  reversePrompt: '',
  agent: '',
  promptOptimize: '',
  layoutSpec: '',
  imageDescribe: '',
  sliceDecomposition: '',
  sliceReconstruct: '',
  sliceImageEdit: '',
};

const DEFAULT_USER_QUOTA = {
  dailyImageTasks: 50,
  dailyVideoTasks: 20,
  dailyTextRequests: 300,
  monthlyImageTasks: 1000,
  monthlyVideoTasks: 300,
  monthlyTextRequests: 6000,
  maxPendingTasks: 3,
  maxParallelCount: 4,
};

const DEFAULT_SETTINGS = {
  siteName: 'Nova Studio',
  /** 视频插件参考素材的公网地址；为空时回退到环境变量，再回退到请求 Host。 */
  publicBaseUrl: '',
  registrationEnabled: false,
  allowByok: false,
  allowUserModelOverride: true,
  announcement: '',
  sessionDays: 30,
  defaultUserQuota: DEFAULT_USER_QUOTA,
  modelDefaults: DEFAULT_MODEL_DEFAULTS,
};

class UserSystemError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'UserSystemError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeQuota(raw, base = DEFAULT_USER_QUOTA) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key) => clampInt(source[key], 0, 1000000, base[key]);
  return {
    dailyImageTasks: pick('dailyImageTasks'),
    dailyVideoTasks: pick('dailyVideoTasks'),
    dailyTextRequests: pick('dailyTextRequests'),
    monthlyImageTasks: pick('monthlyImageTasks'),
    monthlyVideoTasks: pick('monthlyVideoTasks'),
    monthlyTextRequests: pick('monthlyTextRequests'),
    maxPendingTasks: Math.max(1, pick('maxPendingTasks')),
    maxParallelCount: Math.max(1, pick('maxParallelCount')),
  };
}

function unlimitedQuota() {
  return {
    dailyImageTasks: 0,
    dailyVideoTasks: 0,
    dailyTextRequests: 0,
    monthlyImageTasks: 0,
    monthlyVideoTasks: 0,
    monthlyTextRequests: 0,
    maxPendingTasks: 100,
    maxParallelCount: 8,
  };
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new UserSystemError(400, 'INVALID_USERNAME', '用户名需为 3-32 位字母、数字、下划线、点或短横线，且以字母或数字开头');
  }
  return username;
}

function normalizePassword(value) {
  const password = String(value || '');
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new UserSystemError(400, 'WEAK_PASSWORD', `密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (password.length > 200) {
    throw new UserSystemError(400, 'WEAK_PASSWORD', '密码过长');
  }
  return password;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length === 0) return false;
  let actual;
  try {
    actual = scryptSync(String(password), salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createMasterKey(dataDir) {
  const envKey = String(process.env.NOVA_SECRET_KEY || '').trim();
  if (envKey) {
    return createHash('sha256').update(envKey).digest();
  }
  const keyFile = path.join(dataDir, '.nova-secret');
  try {
    if (fs.existsSync(keyFile)) {
      return createHash('sha256').update(fs.readFileSync(keyFile)).digest();
    }
    const secret = randomBytes(32).toString('base64');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    console.log(`[user-system] 未设置 NOVA_SECRET_KEY，已生成数据目录主密钥: ${keyFile}`);
    return createHash('sha256').update(secret).digest();
  } catch (error) {
    console.warn('[user-system] 主密钥文件读写失败，使用进程内临时密钥（重启后已保存的密钥将无法解密）', error?.message || error);
    return createHash('sha256').update(randomBytes(32)).digest();
  }
}

function encryptSecret(masterKey, plain) {
  const text = String(plain || '');
  if (!text) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSecret(masterKey, payload) {
  const raw = String(payload || '');
  if (!raw) return '';
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new UserSystemError(500, 'SECRET_CORRUPTED', '密钥数据格式无效');
  }
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new UserSystemError(500, 'SECRET_DECRYPT_FAILED', '密钥解密失败，请确认 NOVA_SECRET_KEY 未变更');
  }
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    status: row.status,
    quota: normalizeQuota(safeJsonParse(row.quota_json, {}), unlimitedQuotaOrBase(row.role)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function unlimitedQuotaOrBase(role) {
  return role === 'admin' ? unlimitedQuota() : DEFAULT_USER_QUOTA;
}

function inferImagePreset(protocol, upstreamId) {
  const id = String(upstreamId || '').toLowerCase();
  if (protocol === 'grok') {
    if (id.includes('edit')) return 'grok-imagine-image-edit';
    if (id.includes('quality')) return 'grok-imagine-image-quality';
    return 'grok-imagine-image';
  }
  if (protocol === 'doubao') return 'doubao-seedream';
  if (protocol === 'alibaba-dashscope') {
    return id.includes('wan2') ? 'alibaba-wan-image' : 'alibaba-qwen-image';
  }
  if (protocol === 'google') {
    if (id.includes('lite')) return 'gemini-3.1-flash-lite-image';
    if (id.includes('3.1') && id.includes('flash')) return 'gemini-3.1-flash-image-preview';
    if (id.includes('pro')) return 'gemini-3-pro-image-preview';
    if (id.includes('2.5')) return 'gemini-2.5-flash-image';
    return 'gemini-3-pro-image-preview';
  }
  if (id.includes('gemini') && id.includes('image')) return 'antigravity-gemini-image';
  return 'gpt-image-2';
}

function defaultImageCapabilities(protocol, upstreamId) {
  const preset = inferImagePreset(protocol, upstreamId);
  const maxOutputSize =
    protocol === 'grok' ? '1K'
      : protocol === 'doubao' ? '2K'
        : protocol === 'alibaba-dashscope' ? '2K'
          : '4K';
  const maxRefImages =
    protocol === 'grok' ? 0
      : protocol === 'doubao' ? 14
        : protocol === 'alibaba-dashscope' ? 3
          : protocol === 'google' ? 14
            : 16;
  return {
    builtinPreset: preset,
    maxRefImages,
    maxOutputSize,
    supportsAdvancedParams: protocol === 'openai',
  };
}

function normalizeImageCapabilities(raw, protocol, upstreamId) {
  const defaults = defaultImageCapabilities(protocol, upstreamId);
  const source = raw && typeof raw === 'object' ? raw : {};
  const preset = IMAGE_PRESETS.has(String(source.builtinPreset || ''))
    ? String(source.builtinPreset)
    : defaults.builtinPreset;
  return {
    builtinPreset: preset,
    maxRefImages: clampInt(source.maxRefImages, 0, 32, defaults.maxRefImages),
    maxOutputSize: OUTPUT_SIZES.has(String(source.maxOutputSize || ''))
      ? String(source.maxOutputSize)
      : defaults.maxOutputSize,
    supportsAdvancedParams: protocol === 'openai'
      ? Boolean(source.supportsAdvancedParams ?? defaults.supportsAdvancedParams)
      : false,
  };
}

function inferTextProtocol(kind, upstreamId) {
  if (kind === 'google') return 'google-gemini';
  if (kind === 'anthropic-messages') return 'anthropic-messages';
  const id = String(upstreamId || '').toLowerCase();
  if (/^gpt-5(\b|[.-])|^o[1-4](\b|[.-])|^chatgpt/.test(id)) return 'openai-responses';
  return 'openai-chat-completions';
}

function normalizeProtocolForUse(useType, protocol, kind, upstreamId) {
  if (useType === 'image') {
    const value = String(protocol || '');
    if (IMAGE_PROTOCOLS.has(value)) return value;
    if (kind === 'google') return 'google';
    if (kind === 'grok') return 'grok';
    if (kind === 'doubao') return 'doubao';
    if (kind === 'alibaba-dashscope') return 'alibaba-dashscope';
    return 'openai';
  }
  const value = String(protocol || '');
  if (TEXT_PROTOCOLS.has(value)) return value;
  return inferTextProtocol(kind, upstreamId);
}

function createUserSystem({ db, dataDir }) {
  const masterKey = createMasterKey(dataDir);

  // ===== Schema =====

  function tableColumns(table) {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    } catch {
      return [];
    }
  }

  function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        quota_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_enc TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        upstream_id TEXT NOT NULL,
        use_type TEXT NOT NULL,
        protocol TEXT NOT NULL,
        capabilities_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        kind TEXT NOT NULL,
        model_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT,
        actor_name TEXT,
        action TEXT NOT NULL,
        target TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugin_credentials (
        plugin_id TEXT PRIMARY KEY,
        base_url TEXT,
        api_key_enc TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);
      CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_kind_time ON usage_events(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
    `);

    if (!tableColumns('tasks').includes('user_id')) {
      try {
        db.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT');
      } catch (error) {
        console.warn('[user-system] tasks.user_id 添加失败', error?.message || error);
      }
    }
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)');
    } catch {
      /* ignore */
    }

    seedSettings();
    seedAdminFromEnv();
  }

  // ===== Settings =====

  function readSettings() {
    const rows = db.prepare('SELECT key, value_json FROM app_settings').all();
    const stored = {};
    for (const row of rows) stored[row.key] = safeJsonParse(row.value_json, null);
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    settings.defaultUserQuota = normalizeQuota(stored.defaultUserQuota, DEFAULT_USER_QUOTA);
    settings.modelDefaults = { ...DEFAULT_MODEL_DEFAULTS, ...(stored.modelDefaults || {}) };
    settings.sessionDays = clampInt(settings.sessionDays, 1, 365, 30);
    settings.siteName = String(settings.siteName || 'Nova Studio').slice(0, 80);
    settings.announcement = String(settings.announcement || '').slice(0, 2000);
    settings.publicBaseUrl = String(settings.publicBaseUrl || '').trim().replace(/\/+$/, '').slice(0, 500);
    return settings;
  }

  function seedSettings() {
    const exists = db.prepare('SELECT COUNT(*) AS count FROM app_settings').get();
    if (Number(exists?.count || 0) > 0) return;
    const now = nowIso();
    const insert = db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        insert.run(key, JSON.stringify(value), now);
      }
    });
    tx();
  }

  function writeSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(value), nowIso());
  }

  function getSettings() {
    return readSettings();
  }

  function getPublicSettings() {
    const settings = readSettings();
    return {
      siteName: settings.siteName,
      registrationEnabled: Boolean(settings.registrationEnabled),
      allowByok: Boolean(settings.allowByok),
      allowUserModelOverride: Boolean(settings.allowUserModelOverride),
      announcement: settings.announcement,
      setupRequired: isSetupRequired(),
    };
  }

  function updateSettings(patch) {
    const current = readSettings();
    const next = { ...current };
    if (patch.siteName !== undefined) next.siteName = String(patch.siteName || '').trim().slice(0, 80) || 'Nova Studio';
    if (patch.registrationEnabled !== undefined) next.registrationEnabled = Boolean(patch.registrationEnabled);
    if (patch.allowByok !== undefined) next.allowByok = Boolean(patch.allowByok);
    if (patch.allowUserModelOverride !== undefined) next.allowUserModelOverride = Boolean(patch.allowUserModelOverride);
    if (patch.announcement !== undefined) next.announcement = String(patch.announcement || '').slice(0, 2000);
    if (patch.publicBaseUrl !== undefined) {
      const value = String(patch.publicBaseUrl || '').trim().replace(/\/+$/, '');
      if (value && !/^https?:\/\//i.test(value)) {
        throw new UserSystemError(400, 'INVALID_PUBLIC_BASE_URL', '公开访问地址必须是 http:// 或 https:// 开头的地址');
      }
      next.publicBaseUrl = value.slice(0, 500);
    }
    if (patch.sessionDays !== undefined) next.sessionDays = clampInt(patch.sessionDays, 1, 365, current.sessionDays);
    if (patch.defaultUserQuota !== undefined) {
      next.defaultUserQuota = normalizeQuota(patch.defaultUserQuota, current.defaultUserQuota);
    }
    if (patch.modelDefaults !== undefined) {
      next.modelDefaults = normalizeModelDefaults(patch.modelDefaults);
    }
    for (const key of ['siteName', 'publicBaseUrl', 'registrationEnabled', 'allowByok', 'allowUserModelOverride', 'announcement', 'sessionDays', 'defaultUserQuota', 'modelDefaults']) {
      writeSetting(key, next[key]);
    }
    return next;
  }

  // ===== Users & sessions =====

  function countUsers() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0);
  }

  function isSetupRequired() {
    return countUsers() === 0;
  }

  function getUserRowById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  function getUserRowByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  }

  function getUserById(id) {
    return serializeUser(getUserRowById(id));
  }

  function listUsers({ search = '' } = {}) {
    const keyword = String(search || '').trim();
    const rows = keyword
      ? db.prepare(`
          SELECT * FROM users
          WHERE username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE
          ORDER BY role = 'admin' DESC, created_at ASC
        `).all(`%${keyword}%`, `%${keyword}%`)
      : db.prepare("SELECT * FROM users ORDER BY role = 'admin' DESC, created_at ASC").all();
    return rows.map(serializeUser);
  }

  function createUser({ username, password, displayName, role = 'user', quota, status = 'active' }) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedPassword = normalizePassword(password);
    if (!ROLES.has(role)) throw new UserSystemError(400, 'INVALID_ROLE', '角色无效');
    if (!USER_STATUSES.has(status)) throw new UserSystemError(400, 'INVALID_STATUS', '状态无效');
    if (getUserRowByUsername(normalizedUsername)) {
      throw new UserSystemError(409, 'USERNAME_TAKEN', '用户名已存在');
    }
    const settings = readSettings();
    const baseQuota = role === 'admin' ? unlimitedQuota() : settings.defaultUserQuota;
    const now = nowIso();
    const id = `user_${randomBytes(12).toString('hex')}`;
    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, status, quota_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      normalizedUsername,
      String(displayName || '').trim().slice(0, 60) || normalizedUsername,
      hashPassword(normalizedPassword),
      role,
      status,
      JSON.stringify(normalizeQuota(quota, baseQuota)),
      now,
      now,
    );
    return getUserById(id);
  }

  function updateUser(id, patch) {
    const row = getUserRowById(id);
    if (!row) throw new UserSystemError(404, 'USER_NOT_FOUND', '用户不存在');
    const updates = [];
    const values = [];
    if (patch.displayName !== undefined) {
      updates.push('display_name = ?');
      values.push(String(patch.displayName || '').trim().slice(0, 60) || row.username);
    }
    if (patch.role !== undefined) {
      if (!ROLES.has(patch.role)) throw new UserSystemError(400, 'INVALID_ROLE', '角色无效');
      if (row.role === 'admin' && patch.role !== 'admin') {
        const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get()?.count || 0);
        if (adminCount <= 1) throw new UserSystemError(409, 'LAST_ADMIN', '不能降级最后一个管理员');
      }
      updates.push('role = ?');
      values.push(patch.role);
    }
    if (patch.status !== undefined) {
      if (!USER_STATUSES.has(patch.status)) throw new UserSystemError(400, 'INVALID_STATUS', '状态无效');
      if (row.role === 'admin' && patch.status !== 'active') {
        const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get()?.count || 0);
        if (adminCount <= 1) throw new UserSystemError(409, 'LAST_ADMIN', '不能停用最后一个管理员');
      }
      updates.push('status = ?');
      values.push(patch.status);
      if (patch.status !== 'active') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
    }
    if (patch.quota !== undefined) {
      const base = row.role === 'admin' ? unlimitedQuota() : readSettings().defaultUserQuota;
      updates.push('quota_json = ?');
      values.push(JSON.stringify(normalizeQuota(patch.quota, base)));
    }
    if (patch.password !== undefined && String(patch.password || '').length > 0) {
      const password = normalizePassword(patch.password);
      updates.push('password_hash = ?');
      values.push(hashPassword(password));
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (updates.length === 0) return getUserById(id);
    updates.push('updated_at = ?');
    values.push(nowIso());
    values.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return getUserById(id);
  }

  function deleteUser(id, actorId) {
    const row = getUserRowById(id);
    if (!row) throw new UserSystemError(404, 'USER_NOT_FOUND', '用户不存在');
    if (id === actorId) throw new UserSystemError(409, 'CANNOT_DELETE_SELF', '不能删除当前登录账号');
    if (row.role === 'admin') {
      const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()?.count || 0);
      if (adminCount <= 1) throw new UserSystemError(409, 'LAST_ADMIN', '不能删除最后一个管理员');
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('UPDATE tasks SET user_id = NULL WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  }

  function seedAdminFromEnv() {
    if (!isSetupRequired()) return;
    const username = String(process.env.NOVA_ADMIN_USERNAME || '').trim();
    const password = String(process.env.NOVA_ADMIN_PASSWORD || '');
    if (!username || !password) return;
    try {
      createUser({ username, password, displayName: '管理员', role: 'admin' });
      console.log(`[user-system] 已根据环境变量创建管理员: ${username}`);
    } catch (error) {
      console.warn('[user-system] 环境变量管理员创建失败:', error?.message || error);
    }
  }

  function setupAdmin({ username, password, displayName }) {
    if (!isSetupRequired()) {
      throw new UserSystemError(409, 'ALREADY_SETUP', '系统已完成初始化');
    }
    return createUser({ username, password, displayName: displayName || '管理员', role: 'admin' });
  }

  function authenticate(username, password) {
    const row = getUserRowByUsername(String(username || '').trim());
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    if (row.status !== 'active') {
      throw new UserSystemError(403, 'USER_DISABLED', '账号已被停用，请联系管理员');
    }
    return serializeUser(row);
  }

  function createSession(userId, { ip = '', userAgent = '', days } = {}) {
    const settings = readSettings();
    const sessionDays = clampInt(days, 1, 365, settings.sessionDays);
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const tokenHash = sha256(token);
    const now = nowIso();
    const expiresAt = addDaysIso(sessionDays);
    db.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, userId, now, expiresAt, String(ip || '').slice(0, 120), String(userAgent || '').slice(0, 300));
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);
    return { token, expiresAt, sessionDays };
  }

  function getSessionUser(token) {
    const raw = String(token || '');
    if (!raw) return null;
    const row = db.prepare(`
      SELECT s.token_hash, s.expires_at, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(sha256(raw));
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    if (row.status !== 'active') {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    return serializeUser(row);
  }

  function deleteSession(token) {
    const raw = String(token || '');
    if (!raw) return;
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(raw));
  }

  function changePassword(userId, currentPassword, newPassword) {
    const row = getUserRowById(userId);
    if (!row) throw new UserSystemError(404, 'USER_NOT_FOUND', '用户不存在');
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw new UserSystemError(400, 'WRONG_PASSWORD', '当前密码不正确');
    }
    const password = normalizePassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(password), nowIso(), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return { ok: true };
  }

  function cleanupSessions() {
    try {
      const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
      if (Number(result.changes || 0) > 0) {
        console.log(`[user-system] 清理过期会话 ${result.changes} 个`);
      }
    } catch (error) {
      console.warn('[user-system] 清理会话失败', error?.message || error);
    }
  }

  // ===== Providers & models =====

  function serializeProvider(row, { includeKey = false } = {}) {
    if (!row) return null;
    let apiKey = '';
    if (row.api_key_enc) {
      try {
        apiKey = decryptSecret(masterKey, row.api_key_enc);
      } catch {
        apiKey = '';
      }
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.base_url,
      enabled: Boolean(row.enabled),
      hasApiKey: Boolean(row.api_key_enc),
      apiKey: includeKey ? apiKey : '',
      apiKeyMasked: maskSecret(apiKey),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listProviders({ includeKey = false } = {}) {
    return db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all()
      .map(row => serializeProvider(row, { includeKey }));
  }

  function getProviderRow(id) {
    return db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  }

  function getProviderSecret(id) {
    const row = getProviderRow(id);
    if (!row) throw new UserSystemError(404, 'PROVIDER_NOT_FOUND', '供应商不存在');
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.base_url,
      apiKey: row.api_key_enc ? decryptSecret(masterKey, row.api_key_enc) : '',
    };
  }

  function createProvider({ name, kind, baseUrl, apiKey, enabled = true }) {
    const normalizedName = String(name || '').trim().slice(0, 60);
    if (!normalizedName) throw new UserSystemError(400, 'INVALID_PROVIDER', '供应商名称不能为空');
    if (!PROVIDER_KINDS.has(kind)) throw new UserSystemError(400, 'INVALID_PROVIDER', '供应商类型无效');
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
      throw new UserSystemError(400, 'INVALID_PROVIDER', 'Base URL 必须是 http/https 地址');
    }
    const id = `prov_${randomBytes(8).toString('hex')}`;
    const now = nowIso();
    db.prepare(`
      INSERT INTO providers (id, name, kind, base_url, api_key_enc, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, normalizedName, kind, normalizedBaseUrl, apiKey ? encryptSecret(masterKey, apiKey) : '', enabled ? 1 : 0, now, now);
    return serializeProvider(getProviderRow(id));
  }

  function updateProvider(id, patch) {
    const row = getProviderRow(id);
    if (!row) throw new UserSystemError(404, 'PROVIDER_NOT_FOUND', '供应商不存在');
    const updates = [];
    const values = [];
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim().slice(0, 60);
      if (!name) throw new UserSystemError(400, 'INVALID_PROVIDER', '供应商名称不能为空');
      updates.push('name = ?');
      values.push(name);
    }
    if (patch.kind !== undefined) {
      if (!PROVIDER_KINDS.has(patch.kind)) throw new UserSystemError(400, 'INVALID_PROVIDER', '供应商类型无效');
      updates.push('kind = ?');
      values.push(patch.kind);
    }
    if (patch.baseUrl !== undefined) {
      const baseUrl = String(patch.baseUrl || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(baseUrl)) throw new UserSystemError(400, 'INVALID_PROVIDER', 'Base URL 必须是 http/https 地址');
      updates.push('base_url = ?');
      values.push(baseUrl);
    }
    if (patch.apiKey !== undefined && String(patch.apiKey).trim() !== '') {
      updates.push('api_key_enc = ?');
      values.push(encryptSecret(masterKey, String(patch.apiKey).trim()));
    }
    if (patch.clearApiKey === true) {
      updates.push('api_key_enc = ?');
      values.push('');
    }
    if (patch.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (updates.length === 0) return serializeProvider(row);
    updates.push('updated_at = ?');
    values.push(nowIso());
    values.push(id);
    db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return serializeProvider(getProviderRow(id));
  }

  function deleteProvider(id) {
    const row = getProviderRow(id);
    if (!row) throw new UserSystemError(404, 'PROVIDER_NOT_FOUND', '供应商不存在');
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
      db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  }

  function serializeModel(row, { provider } = {}) {
    if (!row) return null;
    return {
      id: row.id,
      providerId: row.provider_id,
      providerName: provider ? provider.name : undefined,
      name: row.name,
      upstreamId: row.upstream_id,
      useType: row.use_type,
      protocol: row.protocol,
      capabilities: safeJsonParse(row.capabilities_json, {}),
      enabled: Boolean(row.enabled),
      sortOrder: Number(row.sort_order || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listModels() {
    const providers = new Map(listProviders().map(provider => [provider.id, provider]));
    return db.prepare('SELECT * FROM models ORDER BY sort_order ASC, created_at ASC').all()
      .map(row => serializeModel(row, { provider: providers.get(row.provider_id) }));
  }

  function getModelRow(id) {
    return db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  }

  function normalizeModelPayload(payload, providerRow) {
    const useType = payload.useType === 'text' ? 'text' : payload.useType === 'image' ? 'image' : '';
    if (!useType) throw new UserSystemError(400, 'INVALID_MODEL', '模型用途必须是 image 或 text');
    const upstreamId = String(payload.upstreamId || '').trim().slice(0, 200);
    if (!upstreamId) throw new UserSystemError(400, 'INVALID_MODEL', '上游模型 ID 不能为空');
    const name = String(payload.name || '').trim().slice(0, 80) || upstreamId;
    const protocol = normalizeProtocolForUse(useType, payload.protocol, providerRow.kind, upstreamId);
    const capabilities = useType === 'image'
      ? normalizeImageCapabilities(payload.capabilities, protocol, upstreamId)
      : { note: String(payload.capabilities?.note || '').slice(0, 200) };
    return { name, upstreamId, useType, protocol, capabilities };
  }

  function createModel(payload) {
    const provider = getProviderRow(payload.providerId);
    if (!provider) throw new UserSystemError(404, 'PROVIDER_NOT_FOUND', '供应商不存在');
    const normalized = normalizeModelPayload(payload, provider);
    const id = `model_${randomBytes(8).toString('hex')}`;
    const now = nowIso();
    db.prepare(`
      INSERT INTO models (id, provider_id, name, upstream_id, use_type, protocol, capabilities_json, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      provider.id,
      normalized.name,
      normalized.upstreamId,
      normalized.useType,
      normalized.protocol,
      JSON.stringify(normalized.capabilities),
      payload.enabled === false ? 0 : 1,
      clampInt(payload.sortOrder, -10000, 10000, 0),
      now,
      now,
    );
    return serializeModel(getModelRow(id), { provider: serializeProvider(provider) });
  }

  function updateModel(id, patch) {
    const row = getModelRow(id);
    if (!row) throw new UserSystemError(404, 'MODEL_NOT_FOUND', '模型不存在');
    const provider = getProviderRow(patch.providerId || row.provider_id);
    if (!provider) throw new UserSystemError(404, 'PROVIDER_NOT_FOUND', '供应商不存在');
    const merged = {
      useType: patch.useType !== undefined ? patch.useType : row.use_type,
      upstreamId: patch.upstreamId !== undefined ? patch.upstreamId : row.upstream_id,
      name: patch.name !== undefined ? patch.name : row.name,
      protocol: patch.protocol !== undefined ? patch.protocol : row.protocol,
      capabilities: patch.capabilities !== undefined ? patch.capabilities : safeJsonParse(row.capabilities_json, {}),
    };
    const normalized = normalizeModelPayload(merged, provider);
    db.prepare(`
      UPDATE models
      SET provider_id = ?, name = ?, upstream_id = ?, use_type = ?, protocol = ?, capabilities_json = ?, enabled = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `).run(
      provider.id,
      normalized.name,
      normalized.upstreamId,
      normalized.useType,
      normalized.protocol,
      JSON.stringify(normalized.capabilities),
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled,
      patch.sortOrder !== undefined ? clampInt(patch.sortOrder, -10000, 10000, row.sort_order) : row.sort_order,
      nowIso(),
      id,
    );
    return serializeModel(getModelRow(id), { provider: serializeProvider(provider) });
  }

  function deleteModel(id) {
    const row = getModelRow(id);
    if (!row) throw new UserSystemError(404, 'MODEL_NOT_FOUND', '模型不存在');
    db.prepare('DELETE FROM models WHERE id = ?').run(id);
    return { ok: true };
  }

  function resolveModel(modelConfigId, expectedUse) {
    const row = getModelRow(modelConfigId);
    if (!row) throw new UserSystemError(404, 'MODEL_NOT_FOUND', '模型不存在或已被删除');
    if (!row.enabled) throw new UserSystemError(403, 'MODEL_DISABLED', '该模型已被管理员停用');
    if (expectedUse && row.use_type !== expectedUse) {
      throw new UserSystemError(400, 'MODEL_TYPE_MISMATCH', `该模型不是${expectedUse === 'image' ? '图片' : '文本'}模型`);
    }
    const provider = getProviderRow(row.provider_id);
    if (!provider || !provider.enabled) {
      throw new UserSystemError(403, 'PROVIDER_DISABLED', '该模型所属供应商已被停用');
    }
    if (!provider.api_key_enc) {
      throw new UserSystemError(409, 'PROVIDER_KEY_MISSING', '管理员尚未配置该供应商的 API Key');
    }
    return {
      id: row.id,
      name: row.name,
      upstreamId: row.upstream_id,
      useType: row.use_type,
      protocol: row.protocol,
      baseUrl: provider.base_url,
      apiKey: decryptSecret(masterKey, provider.api_key_enc),
      capabilities: safeJsonParse(row.capabilities_json, {}),
      providerId: provider.id,
      providerName: provider.name,
    };
  }

  function resolveDefaults() {
    const settings = readSettings();
    const models = listModels().filter(model => model.enabled && model.providerId);
    const enabledProviderIds = new Set(listProviders().filter(provider => provider.enabled && provider.hasApiKey).map(provider => provider.id));
    const usable = models.filter(model => enabledProviderIds.has(model.providerId));
    const imageModels = usable.filter(model => model.useType === 'image');
    const textModels = usable.filter(model => model.useType === 'text');
    const next = { ...DEFAULT_MODEL_DEFAULTS, ...settings.modelDefaults };
    const firstImage = imageModels[0]?.id || '';
    const firstText = textModels[0]?.id || '';
    for (const key of ['textToImage', 'imageToImage']) {
      if (!imageModels.some(model => model.id === next[key])) next[key] = firstImage;
    }
    for (const key of ['reversePrompt', 'agent', 'promptOptimize', 'layoutSpec', 'imageDescribe', 'sliceDecomposition', 'sliceReconstruct']) {
      if (!textModels.some(model => model.id === next[key])) next[key] = firstText;
    }
    const sliceCapable = imageModels.filter(model => {
      if (model.protocol !== 'openai') return false;
      if (model.capabilities?.builtinPreset === 'antigravity-gemini-image') return false;
      const upstream = String(model.upstreamId || '').toLowerCase();
      if (upstream.includes('gemini') && upstream.includes('image')) return false;
      return true;
    });
    if (!sliceCapable.some(model => model.id === next.sliceImageEdit)) {
      next.sliceImageEdit = sliceCapable[0]?.id || '';
    }
    return next;
  }

  function normalizeModelDefaults(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const models = listModels();
    const imageIds = new Set(models.filter(model => model.useType === 'image' && model.enabled).map(model => model.id));
    const textIds = new Set(models.filter(model => model.useType === 'text' && model.enabled).map(model => model.id));
    const next = { ...DEFAULT_MODEL_DEFAULTS };
    for (const key of ['textToImage', 'imageToImage', 'sliceImageEdit']) {
      const value = String(source[key] || '');
      next[key] = imageIds.has(value) ? value : '';
    }
    for (const key of ['reversePrompt', 'agent', 'promptOptimize', 'layoutSpec', 'imageDescribe', 'sliceDecomposition', 'sliceReconstruct']) {
      const value = String(source[key] || '');
      next[key] = textIds.has(value) ? value : '';
    }
    return next;
  }

  function updateModelDefaults(patch) {
    const current = resolveDefaults();
    const merged = { ...current, ...(patch || {}) };
    const normalized = normalizeModelDefaults(merged);
    writeSetting('modelDefaults', normalized);
    return resolveDefaults();
  }

  function getPublicModels() {
    const providers = new Map(listProviders().map(provider => [provider.id, provider]));
    const rows = db.prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC').all();
    const imageModels = [];
    const textModels = [];
    for (const row of rows) {
      const provider = providers.get(row.provider_id);
      if (!provider || !provider.enabled || !provider.hasApiKey) continue;
      const capabilities = safeJsonParse(row.capabilities_json, {});
      if (row.use_type === 'image') {
        imageModels.push({
          id: row.id,
          protocol: row.protocol,
          name: row.name,
          modelId: row.upstream_id,
          apiKey: SERVER_KEY_SENTINEL,
          baseUrl: provider.baseUrl,
          builtinPreset: capabilities.builtinPreset || inferImagePreset(row.protocol, row.upstream_id),
          maxRefImages: Number.isFinite(capabilities.maxRefImages) ? capabilities.maxRefImages : 0,
          maxOutputSize: OUTPUT_SIZES.has(String(capabilities.maxOutputSize || '')) ? capabilities.maxOutputSize : '1K',
          supportsAdvancedParams: Boolean(capabilities.supportsAdvancedParams),
          providerName: provider.name,
        });
      } else if (row.use_type === 'text') {
        textModels.push({
          id: row.id,
          protocol: row.protocol,
          name: row.name,
          modelId: row.upstream_id,
          apiKey: SERVER_KEY_SENTINEL,
          baseUrl: provider.baseUrl,
          note: capabilities.note || '',
          providerName: provider.name,
        });
      }
    }
    return {
      imageModels,
      textModels,
      defaults: resolveDefaults(),
      settings: getPublicSettings(),
    };
  }

  // ===== Plugin credentials =====

  function listPluginCredentialStatus() {
    const rows = db.prepare('SELECT plugin_id, base_url, api_key_enc, updated_at FROM plugin_credentials').all();
    const map = {};
    for (const row of rows) {
      map[row.plugin_id] = {
        pluginId: row.plugin_id,
        configured: Boolean(row.api_key_enc),
        hasApiKey: Boolean(row.api_key_enc),
        baseUrl: row.base_url || '',
        apiKeyMasked: maskSecret(row.api_key_enc ? decryptSecret(masterKey, row.api_key_enc) : ''),
        updatedAt: row.updated_at,
      };
    }
    return map;
  }

  function getPluginCredential(pluginId) {
    const row = db.prepare('SELECT * FROM plugin_credentials WHERE plugin_id = ?').get(pluginId);
    if (!row || !row.api_key_enc) return null;
    return {
      pluginId,
      baseUrl: row.base_url || '',
      apiKey: decryptSecret(masterKey, row.api_key_enc),
      updatedAt: row.updated_at,
    };
  }

  function setPluginCredential(pluginId, { baseUrl, apiKey }) {
    const id = String(pluginId || '').trim();
    if (!id) throw new UserSystemError(400, 'INVALID_PLUGIN', '插件 ID 不能为空');
    const existing = db.prepare('SELECT * FROM plugin_credentials WHERE plugin_id = ?').get(id);
    const nextBaseUrl = baseUrl !== undefined ? String(baseUrl || '').trim().replace(/\/+$/, '') : (existing?.base_url || '');
    let nextKeyEnc = existing?.api_key_enc || '';
    if (apiKey !== undefined && String(apiKey).trim() !== '') {
      nextKeyEnc = encryptSecret(masterKey, String(apiKey).trim());
    }
    if (!nextKeyEnc) throw new UserSystemError(400, 'INVALID_PLUGIN', 'API Key 不能为空');
    db.prepare(`
      INSERT INTO plugin_credentials (plugin_id, base_url, api_key_enc, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET base_url = excluded.base_url, api_key_enc = excluded.api_key_enc, updated_at = excluded.updated_at
    `).run(id, nextBaseUrl, nextKeyEnc, nowIso());
    return listPluginCredentialStatus()[id];
  }

  function deletePluginCredential(pluginId) {
    db.prepare('DELETE FROM plugin_credentials WHERE plugin_id = ?').run(pluginId);
    return { ok: true };
  }

  // ===== Usage & quota =====

  function getUserQuota(userId) {
    const row = getUserRowById(userId);
    if (!row) return { ...DEFAULT_USER_QUOTA };
    const base = row.role === 'admin' ? unlimitedQuota() : readSettings().defaultUserQuota;
    return normalizeQuota(safeJsonParse(row.quota_json, {}), base);
  }

  function usageCount(userId, kind, sinceIso) {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM usage_events
      WHERE user_id = ? AND kind = ? AND created_at >= ?
    `).get(userId, kind, sinceIso);
    return Number(row?.count || 0);
  }

  function startOfDayIso() {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  function startOfMonthIso() {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  function checkQuota(userId, kind, { parallelCount = 1, pendingCount = 0 } = {}) {
    const user = getUserById(userId);
    if (!user || user.role === 'admin') return { ok: true };
    const quota = getUserQuota(userId);
    const dayStart = startOfDayIso();
    const monthStart = startOfMonthIso();
    const limits = {
      image: { daily: quota.dailyImageTasks, monthly: quota.monthlyImageTasks, label: '图片任务' },
      video: { daily: quota.dailyVideoTasks, monthly: quota.monthlyVideoTasks, label: '视频任务' },
      text: { daily: quota.dailyTextRequests, monthly: quota.monthlyTextRequests, label: '文本请求' },
    };
    const limit = limits[kind] || limits.image;
    if (limit.daily > 0) {
      const used = usageCount(userId, kind, dayStart);
      if (used >= limit.daily) {
        throw new UserSystemError(429, 'QUOTA_EXCEEDED', `今日${limit.label}额度已用完（${used}/${limit.daily}），请明天再试或联系管理员`);
      }
    }
    if (limit.monthly > 0) {
      const used = usageCount(userId, kind, monthStart);
      if (used >= limit.monthly) {
        throw new UserSystemError(429, 'QUOTA_EXCEEDED', `本月${limit.label}额度已用完（${used}/${limit.monthly}），请联系管理员`);
      }
    }
    if (pendingCount >= quota.maxPendingTasks) {
      throw new UserSystemError(429, 'TOO_MANY_PENDING_TASKS', `待处理任务已达上限（${quota.maxPendingTasks} 个），请等待完成后再提交`);
    }
    if (parallelCount > quota.maxParallelCount) {
      throw new UserSystemError(400, 'PARALLEL_LIMIT', `单次并发生成数量不能超过 ${quota.maxParallelCount}`);
    }
    return { ok: true, quota };
  }

  function recordUsage({ userId, kind, modelId = '', taskId = '', status = 'created' }) {
    if (!userId) return;
    try {
      db.prepare(`
        INSERT INTO usage_events (user_id, kind, model_id, task_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, kind, String(modelId || ''), String(taskId || ''), status, nowIso());
    } catch (error) {
      console.warn('[user-system] 记录用量失败', error?.message || error);
    }
  }

  function updateUsageStatus(taskId, status) {
    if (!taskId) return;
    try {
      db.prepare('UPDATE usage_events SET status = ? WHERE task_id = ?').run(status, taskId);
    } catch {
      /* ignore */
    }
  }

  function getUsageSummary(days = 30) {
    const safeDays = clampInt(days, 1, 365, 30);
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    const byKind = db.prepare(`
      SELECT kind, COUNT(*) AS count FROM usage_events WHERE created_at >= ? GROUP BY kind
    `).all(since);
    const byDay = db.prepare(`
      SELECT substr(created_at, 1, 10) AS day, kind, COUNT(*) AS count
      FROM usage_events WHERE created_at >= ?
      GROUP BY day, kind ORDER BY day ASC
    `).all(since);
    const byUser = db.prepare(`
      SELECT u.id, u.username, u.display_name, COUNT(e.id) AS count,
        SUM(CASE WHEN e.kind = 'image' THEN 1 ELSE 0 END) AS image_count,
        SUM(CASE WHEN e.kind = 'video' THEN 1 ELSE 0 END) AS video_count,
        SUM(CASE WHEN e.kind IN ('text', 'image-edit') THEN 1 ELSE 0 END) AS text_count
      FROM usage_events e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ?
      GROUP BY e.user_id ORDER BY count DESC
    `).all(since);
    const totals = db.prepare(`
      SELECT COUNT(*) AS count FROM usage_events WHERE created_at >= ?
    `).get(since);
    return {
      days: safeDays,
      since,
      total: Number(totals?.count || 0),
      byKind: Object.fromEntries(byKind.map(row => [row.kind, Number(row.count || 0)])),
      byDay: byDay.map(row => ({ day: row.day, kind: row.kind, count: Number(row.count || 0) })),
      byUser: byUser.map(row => ({
        userId: row.id,
        username: row.username || '(已删除)',
        displayName: row.display_name || row.username || '(已删除)',
        count: Number(row.count || 0),
        imageCount: Number(row.image_count || 0),
        videoCount: Number(row.video_count || 0),
        textCount: Number(row.text_count || 0),
      })),
    };
  }

  function getMyUsage(userId) {
    const quota = getUserQuota(userId);
    const dayStart = startOfDayIso();
    const monthStart = startOfMonthIso();
    const day = db.prepare(`
      SELECT kind, COUNT(*) AS count FROM usage_events WHERE user_id = ? AND created_at >= ? GROUP BY kind
    `).all(userId, dayStart);
    const month = db.prepare(`
      SELECT kind, COUNT(*) AS count FROM usage_events WHERE user_id = ? AND created_at >= ? GROUP BY kind
    `).all(userId, monthStart);
    return {
      quota,
      today: Object.fromEntries(day.map(row => [row.kind, Number(row.count || 0)])),
      month: Object.fromEntries(month.map(row => [row.kind, Number(row.count || 0)])),
    };
  }

  // ===== Audit =====

  function audit(actor, action, target = '', detail = null) {
    try {
      db.prepare(`
        INSERT INTO audit_logs (actor_id, actor_name, action, target, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        actor?.id || null,
        actor?.username || '',
        String(action || '').slice(0, 100),
        String(target || '').slice(0, 200),
        detail ? JSON.stringify(detail).slice(0, 4000) : null,
        nowIso(),
      );
    } catch (error) {
      console.warn('[user-system] 写审计日志失败', error?.message || error);
    }
  }

  function listAudit({ limit = 100, offset = 0 } = {}) {
    const safeLimit = clampInt(limit, 1, 500, 100);
    const safeOffset = clampInt(offset, 0, 1000000, 0);
    return db.prepare(`
      SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset).map(row => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      target: row.target,
      detail: safeJsonParse(row.detail_json, null),
      createdAt: row.created_at,
    }));
  }

  // ===== Admin overview =====

  function getOverview({ queueStats = null } = {}) {
    const today = startOfDayIso();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    const activeUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'active'").get();
    const admins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get();
    const todayTasks = db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ?').get(today);
    const todayCompleted = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ? AND status = 'completed'").get(today);
    const todayFailed = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ? AND status = 'failed'").get(today);
    const weekTasks = db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ?').get(weekAgo);
    const recentTasks = db.prepare(`
      SELECT t.id, t.status, t.mode, t.created_at, t.completed_at, t.error, u.username
      FROM tasks t LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 12
    `).all();
    const topUsers = db.prepare(`
      SELECT u.id, u.username, u.display_name, COUNT(e.id) AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ?
      GROUP BY e.user_id ORDER BY count DESC LIMIT 8
    `).all(weekAgo);
    return {
      users: {
        total: Number(users?.count || 0),
        active: Number(activeUsers?.count || 0),
        admins: Number(admins?.count || 0),
      },
      tasks: {
        today: Number(todayTasks?.count || 0),
        todayCompleted: Number(todayCompleted?.count || 0),
        todayFailed: Number(todayFailed?.count || 0),
        week: Number(weekTasks?.count || 0),
      },
      queue: queueStats,
      recentTasks: recentTasks.map(row => ({
        id: row.id,
        status: row.status,
        mode: row.mode,
        username: row.username || '(已删除)',
        createdAt: row.created_at,
        completedAt: row.completed_at,
        error: row.error,
      })),
      topUsers: topUsers.map(row => ({
        userId: row.id,
        username: row.username || '(已删除)',
        displayName: row.display_name || row.username || '(已删除)',
        count: Number(row.count || 0),
      })),
    };
  }

  function listTasks({ status = '', userId = '', limit = 50, offset = 0 } = {}) {
    const safeLimit = clampInt(limit, 1, 200, 50);
    const safeOffset = clampInt(offset, 0, 1000000, 0);
    const where = [];
    const params = [];
    if (status) {
      where.push('t.status = ?');
      params.push(status);
    }
    if (userId) {
      where.push('t.user_id = ?');
      params.push(userId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks t ${whereSql}`).get(...params);
    const rows = db.prepare(`
      SELECT t.id, t.status, t.mode, t.created_at, t.completed_at, t.expires_at, t.error, t.warning,
        t.user_id, u.username, u.display_name
      FROM tasks t LEFT JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY t.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return {
      total: Number(total?.count || 0),
      items: rows.map(row => ({
        id: row.id,
        status: row.status,
        mode: row.mode,
        userId: row.user_id,
        username: row.username || '(已删除)',
        displayName: row.display_name || row.username || '(已删除)',
        createdAt: row.created_at,
        completedAt: row.completed_at,
        expiresAt: row.expires_at,
        error: row.error,
        warning: row.warning,
      })),
    };
  }

  function getSystemInfo({ version = '', uptimeSeconds = 0 } = {}) {
    const dbStat = (() => {
      try {
        return fs.statSync(db.name);
      } catch {
        return null;
      }
    })();
    return {
      version,
      uptimeSeconds,
      nodeVersion: process.version,
      platform: process.platform,
      dataDir,
      databasePath: db.name,
      databaseBytes: dbStat ? dbStat.size : 0,
      serverMode: true,
      cdpEnabled: String(process.env.NOVA_CDP_ENABLED || 'false').toLowerCase() === 'true',
      secretKeyFromEnv: Boolean(String(process.env.NOVA_SECRET_KEY || '').trim()),
    };
  }

  return {
    initSchema,
    cleanupSessions,
    isSetupRequired,
    seedAdminFromEnv,
    setupAdmin,
    getSettings,
    getPublicSettings,
    updateSettings,
    getUserById,
    getUserQuota,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    authenticate,
    createSession,
    getSessionUser,
    deleteSession,
    changePassword,
    listProviders,
    getProviderSecret,
    createProvider,
    updateProvider,
    deleteProvider,
    listModels,
    createModel,
    updateModel,
    deleteModel,
    resolveModel,
    resolveDefaults,
    updateModelDefaults,
    getPublicModels,
    listPluginCredentialStatus,
    getPluginCredential,
    setPluginCredential,
    deletePluginCredential,
    checkQuota,
    recordUsage,
    updateUsageStatus,
    getUsageSummary,
    getMyUsage,
    audit,
    listAudit,
    getOverview,
    listTasks,
    getSystemInfo,
  };
}

module.exports = {
  createUserSystem,
  UserSystemError,
  SERVER_KEY_SENTINEL,
  SESSION_COOKIE,
  DEFAULT_MODEL_DEFAULTS,
  DEFAULT_USER_QUOTA,
};
