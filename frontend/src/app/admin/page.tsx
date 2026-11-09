'use client';

import { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AuthGate } from '@/components/auth/AuthGate';
import { AdminApp } from '@/components/admin/AdminApp';
import { useSession } from '@/lib/session-context';

function AdminGuard() {
  const { user } = useSession();

  useEffect(() => {
    if (user.role !== 'admin') {
      window.location.replace('/');
    }
  }, [user.role]);

  if (user.role !== 'admin') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-background">
        <ShieldAlert className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">需要管理员权限，正在返回工作台…</p>
      </div>
    );
  }

  return <AdminApp />;
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AdminGuard />
    </AuthGate>
  );
}
