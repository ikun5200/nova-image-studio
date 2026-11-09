'use client';

/**
 * 部署模式与本地缓存的约定。
 *
 * 服务端托管密钥模式下，模型目录由 /api/nova/models 下发，前端不再持有真实 Key。
 * 为了让既有大量同步调用点（loadRegistry / getCompleteImageModels）保持同步语义，
 * 登录后把服务端模型目录写入 localStorage，并用一个模式标记区分「服务端目录」与
 * 「浏览器自建目录」。
 */

export const SERVER_MODE_KEY = 'nova-server-mode';
export const SERVER_REGISTRY_KEY = 'nova-server-model-registry';
export const USER_DEFAULTS_KEY = 'nova-user-model-defaults';
export const ALLOW_USER_DEFAULTS_KEY = 'nova-server-allow-user-defaults';

/** 服务端模型的占位 Key：只用于通过前端的「配置完整」判断，真实 Key 永不下发。 */
export const SERVER_KEY_SENTINEL = '__nova_server__';

export function isServerMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SERVER_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setServerMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      localStorage.setItem(SERVER_MODE_KEY, '1');
    } else {
      localStorage.removeItem(SERVER_MODE_KEY);
      localStorage.removeItem(SERVER_REGISTRY_KEY);
      localStorage.removeItem(USER_DEFAULTS_KEY);
      localStorage.removeItem(ALLOW_USER_DEFAULTS_KEY);
    }
  } catch {
    /* 隐私模式忽略 */
  }
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 配额或隐私模式忽略 */
  }
}
