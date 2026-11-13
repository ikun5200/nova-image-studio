const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const BACKEND_DIR = path.resolve(__dirname, '..');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(resolve));
}

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw lastError || new Error('Timed out waiting for condition');
}

function sessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/nova_session=([^;]+)/);
  assert.ok(match, `missing session cookie: ${raw}`);
  return `nova_session=${match[1]}`;
}

async function request(baseUrl, pathname, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  return { response, data };
}

test('多用户鉴权、管理员配置与模型密钥服务端解析', { timeout: 90000 }, async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-auth-admin-'));
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          _auth: req.headers.authorization,
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const probe = http.createServer();
  const backendPort = await listen(probe);
  await close(probe);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(backendPort),
      NOVA_TASK_DB: path.join(tempDir, 'tasks.sqlite'),
      NOVA_IMAGE_DIR: path.join(tempDir, 'images'),
      NOVA_CDP_DIR: path.join(tempDir, 'cdp'),
      NOVA_AUTH_DISABLED: 'false',
      NOVA_SECRET_KEY: 'test-secret-key-for-integration',
      NOVA_RATE_LIMIT_MAX_REQUESTS_PER_IP: '10000',
      NOVA_RATE_LIMIT_MAX_REQUESTS_PER_API_KEY: '10000',
      NOVA_MAX_PENDING_TASKS_PER_IP: '10000',
      NOVA_MAX_PENDING_TASKS_PER_API_KEY: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${backendPort}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Backend exited early:\n${output}`);
    const { response } = await request(baseUrl, '/api/nova/health');
    return response.ok;
  });

  // 未登录访问受保护接口应被拒绝
  const anonymous = await request(baseUrl, '/api/nova/queue-status');
  assert.equal(anonymous.response.status, 401);

  const status = await request(baseUrl, '/api/nova/auth/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.data.setupRequired, true);

  const setup = await request(baseUrl, '/api/nova/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'password123', displayName: '管理员' },
  });
  assert.equal(setup.response.status, 200, JSON.stringify(setup.data));
  const adminCookie = sessionCookie(setup.response);
  assert.equal(setup.data.user.role, 'admin');

  const me = await request(baseUrl, '/api/nova/auth/me', { cookie: adminCookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.username, 'admin');

  const provider = await request(baseUrl, '/api/nova/admin/providers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Mock OpenAI',
      kind: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-server-secret',
    },
  });
  assert.equal(provider.response.status, 200, JSON.stringify(provider.data));
  assert.equal(provider.data.provider.apiKey, '');
  assert.match(provider.data.provider.apiKeyMasked, /^sk-?/);

  const model = await request(baseUrl, '/api/nova/admin/models', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      providerId: provider.data.provider.id,
      name: 'Mock Chat',
      upstreamId: 'gpt-4o-mini',
      useType: 'text',
      protocol: 'openai-chat-completions',
    },
  });
  assert.equal(model.response.status, 200, JSON.stringify(model.data));
  const modelId = model.data.model.id;

  const publicModels = await request(baseUrl, '/api/nova/models', { cookie: adminCookie });
  assert.equal(publicModels.response.status, 200);
  assert.equal(publicModels.data.textModels.length, 1);
  assert.equal(publicModels.data.textModels[0].apiKey, '__nova_server__');
  assert.equal(JSON.stringify(publicModels.data).includes('sk-server-secret'), false);

  // 批量导入：新增、跳过已存在、拒绝缺用途的条目
  const importPayload = {
    models: [
      { upstreamId: 'gpt-image-1', name: 'GPT Image 1', useType: 'image', protocol: 'openai' },
      { upstreamId: 'gpt-4o-mini', name: 'Mock Chat', useType: 'text', protocol: 'openai-chat-completions' },
      { upstreamId: 'text-embedding-3-small', name: 'Embedding', useType: 'text' },
      { upstreamId: 'missing-use-type' },
    ],
    skipExisting: true,
  };
  const imported = await request(baseUrl, `/api/nova/admin/providers/${provider.data.provider.id}/import-models`, {
    method: 'POST',
    cookie: adminCookie,
    body: importPayload,
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.imported.length, 2);
  assert.equal(imported.data.skipped, 1);
  assert.equal(imported.data.failed.length, 1);

  const importedAgain = await request(baseUrl, `/api/nova/admin/providers/${provider.data.provider.id}/import-models`, {
    method: 'POST',
    cookie: adminCookie,
    body: importPayload,
  });
  assert.equal(importedAgain.response.status, 200, JSON.stringify(importedAgain.data));
  assert.equal(importedAgain.data.imported.length, 0);
  assert.equal(importedAgain.data.skipped, 3);
  assert.equal(importedAgain.data.failed.length, 1);

  const importedWithUpdate = await request(baseUrl, `/api/nova/admin/providers/${provider.data.provider.id}/import-models`, {
    method: 'POST',
    cookie: adminCookie,
    body: { ...importPayload, skipExisting: false },
  });
  assert.equal(importedWithUpdate.response.status, 200, JSON.stringify(importedWithUpdate.data));
  assert.equal(importedWithUpdate.data.imported.length, 0);
  assert.equal(importedWithUpdate.data.updated.length, 3);
  assert.equal(importedWithUpdate.data.failed.length, 1);

  // 创建普通用户并登录
  const createdUser = await request(baseUrl, '/api/nova/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { username: 'alice', password: 'password123', displayName: 'Alice' },
  });
  assert.equal(createdUser.response.status, 200, JSON.stringify(createdUser.data));

  const login = await request(baseUrl, '/api/nova/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'password123' },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  const userCookie = sessionCookie(login.response);

  const forbidden = await request(baseUrl, '/api/nova/admin/users', { cookie: userCookie });
  assert.equal(forbidden.response.status, 403);

  // 用户用模型 ID 调用文本代理：后端注入真实密钥
  const proxy = await request(baseUrl, '/api/nova/proxy/text', {
    method: 'POST',
    cookie: userCookie,
    body: {
      modelConfigId: modelId,
      protocol: 'openai-chat-completions',
      baseUrl: 'http://should-not-be-used.invalid',
      apiKey: '__nova_server__',
      model: 'ignored-model',
      stream: false,
      requestBody: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
      },
    },
  });
  assert.equal(proxy.response.status, 200, JSON.stringify(proxy.data));
  assert.equal(proxy.data.choices[0].message.content, 'ok');

  const usage = await request(baseUrl, '/api/nova/me/usage', { cookie: userCookie });
  assert.equal(usage.response.status, 200);
  assert.equal(usage.data.today.text, 1);

  // 管理员可以在后台设置公开访问地址，非法地址应被拒绝
  const settingsUpdate = await request(baseUrl, '/api/nova/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { settings: { publicBaseUrl: 'http://192.168.31.88:3030/' } },
  });
  assert.equal(settingsUpdate.response.status, 200, JSON.stringify(settingsUpdate.data));
  assert.equal(settingsUpdate.data.settings.publicBaseUrl, 'http://192.168.31.88:3030');
  assert.deepEqual(settingsUpdate.data.settings.publicBaseUrls, ['http://192.168.31.88:3030']);

  const multiUrlSettings = await request(baseUrl, '/api/nova/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      settings: {
        publicBaseUrls: ['http://192.168.31.88:3030/', 'https://nova.example.com/'],
        auditRetentionDays: 30,
        usageRetentionDays: 90,
      },
    },
  });
  assert.equal(multiUrlSettings.response.status, 200, JSON.stringify(multiUrlSettings.data));
  assert.deepEqual(multiUrlSettings.data.settings.publicBaseUrls, [
    'http://192.168.31.88:3030',
    'https://nova.example.com',
  ]);
  assert.equal(multiUrlSettings.data.settings.auditRetentionDays, 30);
  assert.equal(multiUrlSettings.data.settings.usageRetentionDays, 90);

  const invalidSettings = await request(baseUrl, '/api/nova/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { settings: { publicBaseUrl: 'not-a-url' } },
  });
  assert.equal(invalidSettings.response.status, 400);

  const invalidMultiUrl = await request(baseUrl, '/api/nova/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { settings: { publicBaseUrls: ['https://ok.example.com', 'ftp://bad.example.com'] } },
  });
  assert.equal(invalidMultiUrl.response.status, 400);

  // 随机图片代理只接受固定来源；未登录必须被拦截
  const invalidRandomSource = await request(baseUrl, '/api/nova/random-image?source=evil', {
    cookie: adminCookie,
  });
  assert.equal(invalidRandomSource.response.status, 400);
  const randomImageWithoutAuth = await request(baseUrl, '/api/nova/random-image?source=bing');
  assert.equal(randomImageWithoutAuth.response.status, 401);

  // 停用用户后，其会话应立即失效
  await request(baseUrl, `/api/nova/admin/users/${createdUser.data.user.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'disabled' },
  });
  const afterDisable = await request(baseUrl, '/api/nova/auth/me', { cookie: userCookie });
  assert.equal(afterDisable.response.status, 401);
});
