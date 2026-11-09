'use client';

import { Button } from '@/components/ui/button';
import { isServerMode } from '@/lib/deploy-mode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface MissingApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigure: () => void;
}

export function MissingApiKeyDialog({ open, onOpenChange, onConfigure }: MissingApiKeyDialogProps) {
  const serverMode = isServerMode();
  const handleConfigure = () => {
    onOpenChange(false);
    onConfigure();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{serverMode ? '管理员尚未配置可用模型' : '请先配置 API 密钥'}</DialogTitle>
          <DialogDescription>
            {serverMode
              ? '模型与密钥由部署管理员统一管理。请联系管理员在后台添加可用模型后再试。'
              : 'Nova 模式需要先配置 API 密钥，配置完成后即可生成或转换图片。'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfigure}>
            {serverMode ? '查看设置' : '配置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
