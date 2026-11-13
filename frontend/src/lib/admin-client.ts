'use client';

/** 管理员后台 API 客户端。所有请求都依赖同源会话 Cookie。 */

import type { NovaUser, PublicSettings, UserQuota } from '@/lib/auth-client';
import type { DefaultModels } from '@/lib/nova-models';

export class AdminError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
    this.code = code;
  }
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/nova/admin${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const record = (data && typeof data === 'object') ? data as { error?: string; code?: string } : {};
    throw new AdminError(record.error || `请求失败 (${response.status})`, response.status, record.code);
  }
  return data as T;
}

// ===== 总览 =====

export interface Overview {
  users: { total: number; active: number; admins: number };
  tasks: { today: number; todayCompleted: number; todayFailed: number; week: number };
  queue: {
    processingCount: number;
    queuedCount: number;
    pendingCount: number;
    maxQueueSize: number;
    acceptingNewTasks: boolean;
    configuredConcurrency: number;
  } | null;
  recentTasks: Array<{
    id: string;
    status: string;
    mode: string;
    username: string;
    createdAt: string;
    completedAt?: string;
    error?: string;
  }>;
  topUsers: Array<{ userId: string; username: string; displayName: string; count: number }>;
  settings: AdminSettings;
  system: SystemInfo;
  plugins: { installed: number; failures: number };
}

export interface SystemInfo {
  version: string;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  dataDir: string;
  databasePath: string;
  databaseBytes: number;
  serverMode: boolean;
  cdpEnabled: boolean;
  secretKeyFromEnv: boolean;
}

// ===== 用户 =====

export interface AdminUser extends NovaUser {
  quota: UserQuota;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled';
  quota?: Partial<UserQuota>;
}

export async function fetchUsers(search = ''): Promise<AdminUser[]> {
  const data = await adminRequest<{ users: AdminUser[] }>(`/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  return data.users;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const data = await adminRequest<{ user: AdminUser }>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.user;
}

export async function updateUser(id: string, patch: Record<string, unknown>): Promise<AdminUser> {
  const data = await adminRequest<{ user: AdminUser }>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ===== 供应商 =====

export interface ProviderRecord {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInput {
  name: string;
  kind: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  clearApiKey?: boolean;
}

export async function fetchProviders(): Promise<ProviderRecord[]> {
  const data = await adminRequest<{ providers: ProviderRecord[] }>('/providers');
  return data.providers;
}

export async function createProvider(input: ProviderInput): Promise<ProviderRecord> {
  const data = await adminRequest<{ provider: ProviderRecord }>('/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.provider;
}

export async function updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderRecord> {
  const data = await adminRequest<{ provider: ProviderRecord }>(`/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.provider;
}

export async function deleteProvider(id: string): Promise<void> {
  await adminRequest(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testProvider(id: string): Promise<{ ok: boolean; models: Array<{ id: string; name: string }>; count: number }> {
  return adminRequest(`/providers/${encodeURIComponent(id)}/test`, { method: 'POST', body: '{}' });
}

// ===== 模型 =====

export interface ModelRecord {
  id: string;
  providerId: string;
  providerName?: string;
  name: string;
  upstreamId: string;
  useType: 'image' | 'text';
  protocol: string;
  capabilities: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInput {
  providerId: string;
  name: string;
  upstreamId: string;
  useType: 'image' | 'text';
  protocol: string;
  capabilities?: Record<string, unknown>;
  enabled?: boolean;
  sortOrder?: number;
}

export async function fetchModels(): Promise<{ models: ModelRecord[]; defaults: DefaultModels }> {
  return adminRequest('/models');
}

export async function createModel(input: ModelInput): Promise<ModelRecord> {
  const data = await adminRequest<{ model: ModelRecord }>('/models', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.model;
}

export async function updateModel(id: string, patch: Partial<ModelInput>): Promise<ModelRecord> {
  const data = await adminRequest<{ model: ModelRecord }>(`/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.model;
}

export async function deleteModel(id: string): Promise<void> {
  await adminRequest(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface ImportModelInput {
  upstreamId: string;
  name?: string;
  useType: 'image' | 'text';
  protocol?: string;
  capabilities?: Record<string, unknown>;
}

export interface ImportModelsResult {
  imported: ModelRecord[];
  updated: ModelRecord[];
  skipped: number;
  failed: Array<{ upstreamId: string; error: string }>;
  total: number;
}

export async function importProviderModels(
  providerId: string,
  models: ImportModelInput[],
  skipExisting = true,
): Promise<ImportModelsResult> {
  return adminRequest(`/providers/${encodeURIComponent(providerId)}/import-models`, {
    method: 'POST',
    body: JSON.stringify({ models, skipExisting }),
  });
}

export async function fetchDefaults(): Promise<DefaultModels> {
  const data = await adminRequest<{ defaults: DefaultModels }>('/defaults');
  return data.defaults;
}

export async function saveDefaults(defaults: DefaultModels): Promise<DefaultModels> {
  const data = await adminRequest<{ defaults: DefaultModels }>('/defaults', {
    method: 'PUT',
    body: JSON.stringify({ defaults }),
  });
  return data.defaults;
}

// ===== 任务 =====

export interface AdminTask {
  id: string;
  status: string;
  mode: string;
  userId: string | null;
  username: string;
  displayName: string;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
  error?: string;
  warning?: string;
}

export async function fetchTasks(params: {
  status?: string;
  userId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ total: number; items: AdminTask[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.userId) query.set('userId', params.userId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return adminRequest(`/tasks?${query.toString()}`);
}

export async function deleteTask(id: string): Promise<void> {
  await adminRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ===== 用量 =====

export interface UsageSummary {
  days: number;
  since: string;
  total: number;
  byKind: Record<string, number>;
  byDay: Array<{ day: string; kind: string; count: number }>;
  byUser: Array<{
    userId: string | null;
    username: string;
    displayName: string;
    count: number;
    imageCount: number;
    videoCount: number;
    textCount: number;
  }>;
}

export async function fetchUsage(days = 30): Promise<UsageSummary> {
  return adminRequest(`/usage?days=${days}`);
}

// ===== 审计 =====

export interface AuditItem {
  id: number;
  actorId: string | null;
  actorName: string;
  action: string;
  target: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export async function fetchAudit(limit = 100, offset = 0): Promise<AuditItem[]> {
  const data = await adminRequest<{ items: AuditItem[] }>(`/audit?limit=${limit}&offset=${offset}`);
  return data.items;
}

// ===== 设置 =====

export interface AdminSettings extends PublicSettings {
  /** 视频插件参考素材的公网地址列表；请求优先匹配同 Host，未命中时使用第一个。 */
  publicBaseUrls: string[];
  /** 旧版单地址字段，后端仍会返回，前端不再编辑。 */
  publicBaseUrl?: string;
  sessionDays: number;
  /** 操作审计保留天数，0 表示永久保留。 */
  auditRetentionDays: number;
  /** 用量记录保留天数，0 表示永久保留。 */
  usageRetentionDays: number;
  defaultUserQuota: UserQuota;
  modelDefaults: DefaultModels;
}

export async function fetchSettings(): Promise<AdminSettings> {
  const data = await adminRequest<{ settings: AdminSettings }>('/settings');
  return data.settings;
}

export async function saveSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  const data = await adminRequest<{ settings: AdminSettings }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: patch }),
  });
  return data.settings;
}

// ===== 插件 =====

export interface AdminPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  credential?: { label?: string; defaultBaseUrl?: string };
}

export interface AdminPluginSnapshot {
  plugins: AdminPlugin[];
  failures: Array<{ id: string; error: string }>;
  pluginsDir: string;
  credentials: Record<string, {
    pluginId: string;
    configured: boolean;
    hasApiKey: boolean;
    baseUrl: string;
    apiKeyMasked: string;
    updatedAt: string;
  }>;
}

export async function fetchPlugins(): Promise<AdminPluginSnapshot> {
  return adminRequest('/plugins');
}

export async function savePluginCredential(
  pluginId: string,
  credential: { apiKey?: string; baseUrl?: string },
): Promise<void> {
  await adminRequest(`/plugins/${encodeURIComponent(pluginId)}/credential`, {
    method: 'PUT',
    body: JSON.stringify(credential),
  });
}

export async function deletePluginCredential(pluginId: string): Promise<void> {
  await adminRequest(`/plugins/${encodeURIComponent(pluginId)}/credential`, { method: 'DELETE' });
}

export async function fetchSystem(): Promise<SystemInfo> {
  return adminRequest('/system');
}

export async function fetchOverview(): Promise<Overview> {
  return adminRequest('/overview');
}
