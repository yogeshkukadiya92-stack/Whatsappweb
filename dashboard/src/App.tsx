import { useState, useEffect, useCallback, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazyWithRetry as lazy } from './utils/lazyWithRetry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { useRole } from './hooks/useRole';
import { RoleProvider } from './components/RoleProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { API_BASE_URL, refreshSupabaseSession } from './services/api';
import { clearActorState, isUserRole, resolveStartupValidation } from './utils/authLifecycle';
import {
  getStoredApiKey,
  getStoredRefreshToken,
  getStoredTokenExpiresAt,
  setStoredAuth,
  clearStoredAuth,
} from './utils/authStorage';
import './App.css';

const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Sessions = lazy(() => import('./pages/Sessions').then(m => ({ default: m.Sessions })));
const Chats = lazy(() => import('./pages/Chats').then(m => ({ default: m.Chats })));
const Webhooks = lazy(() => import('./pages/Webhooks').then(m => ({ default: m.Webhooks })));
const Templates = lazy(() => import('./pages/Templates').then(m => ({ default: m.Templates })));
const Logs = lazy(() => import('./pages/Logs').then(m => ({ default: m.Logs })));
const ApiKeys = lazy(() => import('./pages/ApiKeys').then(m => ({ default: m.ApiKeys })));
const MessageTester = lazy(() => import('./pages/MessageTester').then(m => ({ default: m.MessageTester })));
const Infrastructure = lazy(() => import('./pages/Infrastructure').then(m => ({ default: m.Infrastructure })));
const Plugins = lazy(() => import('./pages/Plugins'));
const AiChatbot = lazy(() => import('./pages/AiChatbot').then(m => ({ default: m.AiChatbot })));
const LeadCapture = lazy(() => import('./pages/LeadCapture').then(m => ({ default: m.LeadCapture })));
const Campaigns = lazy(() => import('./pages/Campaigns').then(m => ({ default: m.Campaigns })));
const AutomationStudio = lazy(() => import('./pages/AutomationStudio'));
const GroupContacts = lazy(() => import('./pages/GroupContacts').then(m => ({ default: m.GroupContacts })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AppContent() {
  // Capture the key ONCE at mount. Read live per render, the null→key transition when
  // handleLogin stores a fresh key would re-fire the startup re-validation effect below and
  // double the /auth/validate request on every sign-in — the effect is for genuine page
  // refreshes with a saved key only.
  const [savedKey] = useState(() => getStoredApiKey());
  const [isAuthenticated, setIsAuthenticated] = useState(!!savedKey);
  const [, setApiKey] = useState(savedKey || '');
  const { setRole, setUser, role } = useRole();

  const handleLogin = (
    key: string,
    validatedRole?: string,
    name?: string,
    allowedSessions?: string[] | null,
    supabaseSession?: { refreshToken: string; expiresIn: number },
  ) => {
    setApiKey(key);
    setStoredAuth(key, supabaseSession?.refreshToken, supabaseSession?.expiresIn);

    // The login page's validate response already carried the role, so no second /auth/validate
    // round-trip is needed here. An absent or unrecognized role falls back to viewer, the
    // least-privileged default.
    const resolvedRole = isUserRole(validatedRole) ? validatedRole : 'viewer';
    setRole(resolvedRole);
    setUser({
      name: name || null,
      role: resolvedRole,
      allowedSessions: allowedSessions || null,
    });

    setIsAuthenticated(true);
  };

  const handleLogout = useCallback(() => {
    setApiKey('');
    setIsAuthenticated(false);
    setRole(null);
    setUser(null);
    clearStoredAuth();
    // Wipe the React Query cache too: it is keyed by resource, not actor, so without a full
    // clear a logout → login in the same tab with a different key/scope shows the previous
    // actor's sessions/messages/apiKeys/audit rows.
    clearActorState(queryClient);
  }, [setRole, setUser]);

  // Re-validate and refresh the role on mount if already authenticated
  useEffect(() => {
    if (!savedKey) return;

    const validate = (key: string) =>
      fetch(`${API_BASE_URL}/auth/validate`, {
        method: 'POST',
        headers: { 'X-API-Key': key },
      });

    let active = true;

    (async () => {
      try {
        let currentKey = savedKey;
        const expiresAt = getStoredTokenExpiresAt();
        // If the access token already expired while tab/browser was closed, refresh before validate
        if (expiresAt && Date.now() >= expiresAt) {
          const refreshed = await refreshSupabaseSession();
          if (refreshed) {
            currentKey = refreshed;
            setApiKey(refreshed);
          }
        }

        const first = await validate(currentKey);
        const refreshed = first.status === 401 ? await refreshSupabaseSession() : null;
        if (refreshed) {
          setApiKey(refreshed);
        }
        const res = refreshed ? await validate(refreshed) : first;
        const json = await res.json().catch(() => null);
        const decision = resolveStartupValidation(res.status, json);
        if (!active) return;
        if (decision.action === 'logout') {
          handleLogout();
        } else if (decision.action === 'role') {
          setRole(decision.role);
          setUser({
            name: json?.name || null,
            role: decision.role,
            allowedSessions: json?.allowedSessions || null,
          });
        }
      } catch {
        // Network failure (API unreachable): keep the cached role so a transient outage at
        // page load doesn't eject the user — an explicit 401/403 above still logs out.
      }
    })();

    return () => {
      active = false;
    };
  }, [savedKey, setRole, setUser, handleLogout]);

  // Proactively refresh tokens before expiration and sync cross-tab auth state
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkAndRefresh = async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return;

      const expiresAt = getStoredTokenExpiresAt();
      // Refresh when 5 minutes or less remain before expiry, or if expired
      const shouldRefresh = expiresAt ? Date.now() >= expiresAt - 5 * 60 * 1000 : false;

      if (shouldRefresh) {
        const newToken = await refreshSupabaseSession();
        if (newToken) {
          setApiKey(newToken);
        }
      }
    };

    // Periodic check every 60 seconds
    const interval = setInterval(() => {
      void checkAndRefresh();
    }, 60_000);

    // Check immediately when user switches back to this tab or window gets focused
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkAndRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    // Cross-tab sync: if another tab logs out, log out this tab too
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'openwa_api_key') {
        if (!e.newValue) {
          handleLogout();
        } else {
          setApiKey(e.newValue);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isAuthenticated, handleLogout]);

  const loadingFallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Loader2 className="animate-spin" size={32} />
    </div>
  );

  if (!isAuthenticated) {
    return (
      <Suspense fallback={loadingFallback}>
        <Login onLogin={handleLogin} />
      </Suspense>
    );
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={loadingFallback}>
          <Routes>
            <Route path="/" element={<Layout onLogout={handleLogout} userRole={role} />}>
              <Route index element={<Dashboard />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="chats" element={<Chats />} />
              <Route path="webhooks" element={<Webhooks />} />
              <Route path="templates" element={<Templates />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="ai-chatbot" element={<AiChatbot />} />
              <Route path="lead-capture" element={<LeadCapture />} />
              <Route path="automation-studio" element={<AutomationStudio />} />
              <Route path="group-contacts" element={<GroupContacts />} />
              {role === 'admin' && <Route path="api-keys" element={<ApiKeys />} />}

              <Route path="logs" element={<Logs />} />
              <Route path="message-tester" element={<MessageTester />} />
              {role === 'admin' && <Route path="infrastructure" element={<Infrastructure />} />}
              {role === 'admin' && <Route path="plugins" element={<Plugins />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RoleProvider>
          <AppContent />
        </RoleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
