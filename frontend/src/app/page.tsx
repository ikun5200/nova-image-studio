'use client';

import { AuthGate } from '@/components/auth/AuthGate';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

export default function Home() {
  return (
    <AuthGate>
      <WorkspaceShell />
    </AuthGate>
  );
}
