import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/layout/Guards';
import { Spinner } from './components/ui';
import { useApp } from './lib/context';

const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Documents = lazy(() => import('./pages/Documents'));
const DocumentReview = lazy(() => import('./pages/DocumentReview'));
const Profile = lazy(() => import('./pages/Profile'));
const Regime = lazy(() => import('./pages/Regime'));
const Scenarios = lazy(() => import('./pages/Scenarios'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Planner = lazy(() => import('./pages/Planner'));
const Deductions = lazy(() => import('./pages/Deductions'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Traders = lazy(() => import('./pages/Traders'));
const Crypto = lazy(() => import('./pages/Crypto'));
const Ais = lazy(() => import('./pages/Ais'));
const Itr = lazy(() => import('./pages/Itr'));
const Household = lazy(() => import('./pages/Household'));
const Rules = lazy(() => import('./pages/Rules'));
const Settings = lazy(() => import('./pages/Settings'));

const Fallback = () => <div className="grid min-h-[50vh] place-items-center"><Spinner className="size-6" /></div>;
const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Fallback />}>{children}</Suspense>;

function Home() {
  const { user, loading } = useApp();
  if (loading) return <Fallback />;
  return user ? <Navigate to={user.onboardedAt ? '/dashboard' : '/onboarding'} replace /> : <S><Landing /></S>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<S><Auth mode="login" /></S>} />
      <Route path="/register" element={<S><Auth mode="register" /></S>} />
      <Route path="/onboarding" element={<RequireAuth allowUnonboarded><S><Onboarding /></S></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/dashboard" element={<S><Dashboard /></S>} />
        <Route path="/documents" element={<S><Documents /></S>} />
        <Route path="/documents/:id" element={<S><DocumentReview /></S>} />
        <Route path="/profile" element={<S><Profile /></S>} />
        <Route path="/regime" element={<S><Regime /></S>} />
        <Route path="/scenarios" element={<S><Scenarios /></S>} />
        <Route path="/portfolio" element={<S><Portfolio /></S>} />
        <Route path="/planner" element={<S><Planner /></S>} />
        <Route path="/deductions" element={<S><Deductions /></S>} />
        <Route path="/assistant" element={<S><Assistant /></S>} />
        <Route path="/traders" element={<S><Traders /></S>} />
        <Route path="/crypto" element={<S><Crypto /></S>} />
        <Route path="/ais" element={<S><Ais /></S>} />
        <Route path="/itr" element={<S><Itr /></S>} />
        <Route path="/household" element={<S><Household /></S>} />
        <Route path="/rules" element={<S><Rules /></S>} />
        <Route path="/settings" element={<S><Settings /></S>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
