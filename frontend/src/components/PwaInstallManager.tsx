'use client';

import { useEffect } from 'react';
import { initPwaInstallListener } from '@/lib/pwa-install';

/**
 * 接住 beforeinstallprompt；同时在安全上下文里确保 Service Worker 已注册。
 * HTTP 局域网地址不是安全上下文，浏览器不允许注册 SW，这里直接跳过。
 */
export function PwaInstallManager() {
  useEffect(() => {
    const cleanup = initPwaInstallListener();
    if (
      process.env.NODE_ENV === 'production'
      && typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && window.isSecureContext
    ) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 注册失败不影响主流程，安装卡片会提示改用 HTTPS
      });
    }
    return cleanup;
  }, []);

  return null;
}
