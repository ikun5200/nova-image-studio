'use client';

import { getCompleteImageModels, getCompleteTextModels, loadRegistry } from '@/lib/nova-models';
import { isServerMode } from '@/lib/deploy-mode';

export function getStoredApiKey(): string {
  const registry = loadRegistry();
  const imageModel = getCompleteImageModels(registry)[0];
  const textModel = getCompleteTextModels(registry)[0];
  return imageModel?.apiKey || textModel?.apiKey || '';
}

export function setStoredApiKey(): boolean {
  return true;
}

export function removeStoredApiKey(): void {
  // 开源版改为模型级别独立存储，不再提供全局 key 写入口。
}

export const getStoredCcodeKey = getStoredApiKey;
export const setStoredCcodeKey = setStoredApiKey;
export const removeStoredCcodeKey = removeStoredApiKey;

export function getApiKeyFromStorage(): string {
  return getStoredApiKey();
}

export function hasAnyApiKey(): boolean {
  const registry = loadRegistry();
  if (isServerMode()) {
    // 服务端模式：只要管理员配置了任意一类模型，用户端就不该再提示「密钥未配置」。
    return getCompleteImageModels(registry).length > 0 || getCompleteTextModels(registry).length > 0;
  }
  return getCompleteImageModels(registry).length > 0 && getCompleteTextModels(registry).length > 0;
}

export function loadJsonFromStorage<T>(key: string): Partial<T> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : {};
}

export function saveJsonToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}
