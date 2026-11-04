import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userAuthApi } from '../services/api';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Smartphone, MessageSquare, Send, Menu, X } from 'lucide-react';
import { useSessionsQuery } from '../hooks/queries';
import { type UserRole, useRole } from '../hooks/useRole';
import { billingApi, type BillingStatus, healthApi } from '../services/api';
import { startGlobalMessageScheduler } from '../services/scheduler';
import { Sidebar, sidebarPageTitle } from './Sidebar';
import './Layout.css';
import './EasyWorkspace.css';

interface LayoutProps {
  onLogout: () => void;
  userRole: UserRole | null;
}

export function Layout({ onLogout, userRole }: LayoutProps) {
  const { t } = useTranslation();

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  useEffect(() => {
    const check = () => {
      billingApi
        .status()
        .then(setBilling)
        .catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 30000);
    window.addEventListener('billing-updated', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('billing-updated', check);
    };
  }, []);
  const { user } = useRole();

  const { pathname } = useLocation();
  const access = useQuery({
    queryKey: ['feature-profile', user?.name],
    queryFn: userAuthApi.getProfile,
    enabled: userRole !== 'admin',
    refetchOnWindowFocus: true,
  });
  const featureRoutes: Record<string, string> = {
    '/sessions': 'sessions',
    '/analytics': 'analytics',
    '/logs': 'logs',
    '/chats': 'messaging',
    '/message-tester': 'messaging',
    '/group-contacts': 'contacts',
    '/campaigns': 'campaigns',
    '/ai-chatbot': 'ai',
    '/lead-capture': 'leads',
    '/automations': 'automations',
    '/automation-studio': 'automations',
    '/webhooks': 'webhooks',
    '/templates': 'templates',
  };
  const visible = (path: string) =>
    userRole === 'admin' ||
    !featureRoutes[path] ||
    (access.isSuccess && (access.data.user?.features?.includes(featureRoutes[path]) ?? true));

  const [isCollapsed, setIsCollapsed] = useState(false);
  const sessions = useSessionsQuery();
  const readySessions = sessions.data?.filter(s => s.status === 'ready') ?? [];
  const primarySession = readySessions[0] ?? sessions.data?.[0];
  const accountState: 'loading' | 'none' | 'ok' | 'down' = sessions.isPending
    ? 'loading'
    : !sessions.data?.length
      ? 'none'
      : readySessions.length
        ? 'ok'
        : 'down';
  const currentPage = sidebarPageTitle(pathname);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  // Show the build-time version immediately, then replace it with the live running version from the
  // backend so a stale-built bundle can't display the wrong number. Falls back silently on error.
  const [version, setVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let active = true;
    healthApi
      .check()
      .then(info => {
        if (active && info?.version) setVersion(info.version);
      })
      .catch(() => {
        /* keep the build-time fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  // Global background message scheduler for groups, polls and direct messages
  useEffect(() => {
    return startGlobalMessageScheduler();
  }, []);

  const handleNavClick = () => {
    if (isMobile) setIsMobileOpen(false);
  };

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

  return (
    <div className="layout easy-workspace">
      {isMobile && (
        <header className="mobile-header">
          <button className="mobile-menu-btn" onClick={toggleMobile} aria-label={t('common.expand')}>
            {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div className="mobile-brand">
            <img src="/waply-3d.png" alt="Waply" className="sidebar-logo-3d mobile" />
            <span className="brand-name">{t('common.appName')}</span>
          </div>
          <div style={{ width: 40 }} />
        </header>
      )}

      {isMobile && isMobileOpen && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <Sidebar
        userRole={userRole}
        isVisible={visible}
        billing={billing}
        version={version}
        isCollapsed={isCollapsed}
        isMobile={isMobile}
        isOpen={isMobileOpen}
        onToggleCollapse={toggleCollapse}
        onNavigate={handleNavClick}
        onLogout={onLogout}
      />

      {isMobile && (
        <nav className="easy-bottom-nav" aria-label="Quick navigation">
          <NavLink to="/" end onClick={handleNavClick}>
            <LayoutDashboard size={20} />
            Home
          </NavLink>
          <NavLink to="/chats" onClick={handleNavClick}>
            <MessageSquare size={20} />
            Inbox
          </NavLink>
          <NavLink to="/message-tester" onClick={handleNavClick}>
            <Send size={20} />
            Messages
          </NavLink>
          <button onClick={toggleMobile} aria-expanded={isMobileOpen}>
            <Menu size={20} />
            More
          </button>
        </nav>
      )}
      <main className={`main-content ${isCollapsed ? 'expanded' : ''} ${isMobile ? 'mobile' : ''}`}>
        <div className="app-topbar">
          <span className="app-topbar-title">{currentPage}</span>
          <div className="app-topbar-right">
            {accountState !== 'loading' && (
              <NavLink
                to="/sessions"
                className={`account-pill ${accountState}`}
                title={
                  accountState === 'ok'
                    ? `${readySessions.length} of ${sessions.data!.length} WhatsApp accounts connected`
                    : 'Open WhatsApp accounts'
                }
              >
                <span className="account-pill-dot" aria-hidden="true" />
                <span className="account-pill-name">
                  {accountState === 'none' ? 'No WhatsApp account' : primarySession?.name || primarySession?.id}
                </span>
                <span className="account-pill-state">
                  {accountState === 'ok' ? 'Connected' : accountState === 'none' ? 'Not set up' : 'Disconnected'}
                </span>
              </NavLink>
            )}
            {(accountState === 'down' || accountState === 'none') && (
              <NavLink to="/sessions" className="topbar-cta">
                <Smartphone size={15} />
                {accountState === 'none' ? 'Connect' : 'Reconnect'}
              </NavLink>
            )}
          </div>
        </div>
        {billing?.account &&
        !billing.access &&
        userRole !== 'admin' &&
        !['/billing', '/setup-help'].includes(pathname) ? (
          <Navigate to="/billing" replace />
        ) : visible(pathname) ? (
          <Outlet />
        ) : (
          <p role="status">
            {access.isLoading
              ? 'Loading account access…'
              : access.isError
                ? 'Could not load account access. Refresh to try again.'
                : 'This feature is disabled for your account.'}
          </p>
        )}
      </main>
    </div>
  );
}
