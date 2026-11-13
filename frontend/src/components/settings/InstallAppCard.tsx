'use client';

import { useState } from 'react';
import { CheckCircle2, Download, Lock, Share, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { promptPwaInstall, usePwaInstall } from '@/lib/pwa-install';

export function InstallAppCard() {
  const { canInstall, installed, isIos, isSecureContext } = usePwaInstall();
  const [message, setMessage] = useState('');

  const handleInstall = async () => {
    const outcome = await promptPwaInstall();
    if (outcome === 'accepted') setMessage('已开始安装，请按浏览器提示完成。');
    else if (outcome === 'dismissed') setMessage('已取消安装，可以随时再试。');
    else setMessage('当前浏览器没有提供安装入口，请刷新页面后再试。');
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">安装 Nova Studio</p>
            {installed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                <CheckCircle2 className="size-3" />
                已安装
              </span>
            )}
          </div>

          {installed ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              当前正以独立应用模式运行，可以从桌面或开始菜单直接启动。
            </p>
          ) : !isSecureContext ? (
            <div className="mt-1 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Lock className="size-3" />
                当前地址不是 HTTPS，浏览器不会允许安装 PWA
              </p>
              <p>
                请通过 HTTPS 地址访问后再安装。可以在后台「公开访问地址」里加入一个 HTTPS 地址，
                例如反向代理域名或 Tailscale 提供的 HTTPS 地址；局域网纯 HTTP 地址受浏览器安全策略限制，无法绕过。
              </p>
            </div>
          ) : canInstall ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                安装后拥有独立窗口、桌面图标，并减少浏览器地址栏占用。
              </p>
              <Button size="sm" onClick={() => void handleInstall()}>
                <Download className="size-3.5" />
                安装到这台设备
              </Button>
            </div>
          ) : isIos ? (
            <div className="mt-1 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Smartphone className="size-3" />
                iPhone / iPad 请使用 Safari 手动添加
              </p>
              <ol className="list-decimal list-inside space-y-1 pl-0.5">
                <li>点击 Safari 工具栏的分享按钮 <Share className="inline size-3" /></li>
                <li>在菜单中选择「添加到主屏幕」</li>
                <li>确认名称后点击「添加」</li>
              </ol>
            </div>
          ) : (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              浏览器暂未提供安装入口。Chrome / Edge 可查看地址栏右侧的安装图标；
              如果已经安装过，这里不会再显示安装按钮。若刚部署完，请刷新页面后再试。
            </p>
          )}

          {message && <p className="mt-2 text-[11px] text-muted-foreground">{message}</p>}
        </div>
      </div>
    </div>
  );
}
