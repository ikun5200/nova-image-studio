'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaInstallSnapshot {
  canInstall: boolean;
  installed: boolean;
  isIos: boolean;
  isSafari: boolean;
  isSecureContext: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedInSession = false;
let initialized = false;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function readSnapshot(): PwaInstallSnapshot {
  if (typeof window === 'undefined') {
    return {
      canInstall: false,
      installed: false,
      isIos: false,
      isSafari: false,
      isSecureContext: false,
    };
  }
  const userAgent = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(userAgent) && !/chrome|chromium|crios|edg|firefox|fxios/i.test(userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const secure = window.isSecureContext === true;
  return {
    canInstall: Boolean(deferredPrompt) && secure && !isStandalone,
    installed: isStandalone || installedInSession,
    isIos,
    isSafari,
    isSecureContext: secure,
  };
}

/** 在根布局挂载一次，尽早接住浏览器抛出的安装事件。 */
export function initPwaInstallListener(): () => void {
  if (typeof window === 'undefined' || initialized) return () => {};
  initialized = true;

  const handleBeforeInstall = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitChange();
  };
  const handleInstalled = () => {
    installedInSession = true;
    deferredPrompt = null;
    emitChange();
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstall);
  window.addEventListener('appinstalled', handleInstalled);

  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    window.removeEventListener('appinstalled', handleInstalled);
    initialized = false;
  };
}

export function usePwaInstall(): PwaInstallSnapshot {
  const [snapshot, setSnapshot] = useState<PwaInstallSnapshot>(() => readSnapshot());

  useEffect(() => {
    const update = () => setSnapshot(readSnapshot());
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  return snapshot;
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  emitChange();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
