'use client';

/**
 * 服务端模型目录的落地层。
 *
 * 管理员在后台维护供应商、模型与全局默认值；普通用户登录后只读这份目录，
 * 并可在管理员允许时覆盖「个人默认模型」（存在本机，不影响其他人）。
 */

import {
  ALLOW_USER_DEFAULTS_KEY,
  SERVER_REGISTRY_KEY,
  isServerMode,
  readJsonStorage,
  setServerMode,
  writeJsonStorage,
} from '@/lib/deploy-mode';
import type { DefaultModels, ImageModelConfig, TextModelConfig } from '@/lib/nova-models';

export interface ServerModelsPayload {
  imageModels: ImageModelConfig[];
  textModels: TextModelConfig[];
  defaults: DefaultModels;
  settings?: {
    allowUserModelOverride?: boolean;
    [key: string]: unknown;
  };
}

export async function fetchServerModels(): Promise<ServerModelsPayload> {
  const response = await fetch('/api/nova/models', { cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `读取模型目录失败 (${response.status})`);
  }
  return await response.json() as ServerModelsPayload;
}

/** 登录成功后调用：把服务端目录写入本地缓存，并打开服务端模式。 */
export function hydrateServerModels(payload: ServerModelsPayload): void {
  const registry = {
    providers: [],
    imageModels: Array.isArray(payload.imageModels) ? payload.imageModels : [],
    textModels: Array.isArray(payload.textModels) ? payload.textModels : [],
    defaults: payload.defaults || {},
  };
  writeJsonStorage(SERVER_REGISTRY_KEY, registry);
  setServerMode(true);
  const allowOverride = payload.settings?.allowUserModelOverride !== false;
  try {
    localStorage.setItem(ALLOW_USER_DEFAULTS_KEY, allowOverride ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function clearServerModels(): void {
  setServerMode(false);
}

export function isUserDefaultOverrideAllowed(): boolean {
  if (!isServerMode()) return true;
  try {
    return localStorage.getItem(ALLOW_USER_DEFAULTS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 个人默认模型覆盖项（只存被用户主动改过的 key）。 */
export function getUserModelDefaults(): Partial<DefaultModels> {
  return readJsonStorage<Partial<DefaultModels>>('nova-user-model-defaults', {});
}

export function saveUserModelDefaults(patch: Partial<DefaultModels>): Partial<DefaultModels> {
  const current = getUserModelDefaults();
  const next = { ...current, ...patch };
  writeJsonStorage('nova-user-model-defaults', next);
  return next;
}

export function resetUserModelDefaults(): void {
  try {
    localStorage.removeItem('nova-user-model-defaults');
  } catch {
    /* ignore */
  }
}

/** 供设置页展示：把服务端目录读出来（不走网络）。 */
export function getCachedServerModels(): ServerModelsPayload | null {
  if (!isServerMode()) return null;
  const cached = readJsonStorage<ServerModelsPayload | null>(SERVER_REGISTRY_KEY, null);
  return cached;
}
