'use client';

import { useEffect } from 'react';

/**
 * 根布局里的 #app-boot-loader 是首屏防闪烁遮罩。
 *
 * 工作台由 useWideMode 负责移除，但登录页 / 初始化页 / 管理后台不挂载该 Hook，
 * 遮罩会一直盖在页面上，视觉上就是白屏。这里在任意页面挂载后统一移除。
 */
export function BootLoaderCleanup() {
  useEffect(() => {
    document.getElementById('app-boot-loader')?.remove();
  }, []);

  return null;
}
