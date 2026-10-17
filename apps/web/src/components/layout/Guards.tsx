import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../../lib/context';
import { Spinner } from '../ui';

export function RequireAuth({ children, allowUnonboarded }: { children: ReactNode; allowUnonboarded?: boolean }) {
  const { user, loading } = useApp();
  const loc = useLocation();
  if (loading || user === undefined) return <div className="grid h-screen place-items-center"><Spinner className="size-6" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!user.onboardedAt && !allowUnonboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
