import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  Webhook,
  Users,
  FileText,
  ClipboardList,
  LogOut,
  Send,
  Radio,
  Server,
  Puzzle,
  Bot,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Languages,
  Contact,
  CreditCard,
  BarChart3,
  Workflow,
  UserPlus,
  Wrench,
  ChevronDown,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { type UserRole, useRole } from '../hooks/useRole';
import { languageOptions, resolveSupportedLanguage, rtlLanguages, type SupportedLanguage } from '../i18n';
import { billingApi, type BillingStatus, healthApi } from '../services/api';
import { startGlobalMessageScheduler } from '../services/scheduler';
import './Layout.css';
import './EasyWorkspace.css';

interface LayoutProps {
  onLogout: () => void;
  userRole: UserRole | null;
}

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  hint: string;
  adminOnly?: boolean;
};

// Plain-language menu, grouped by what people come to do. Labels match each page's title so the
// menu and the page always say the same thing; hints show on hover to explain each tool in one line.
const navGroups: { id: string; label: string; collapsible?: boolean; items: NavItem[] }[] = [
  {
    id: 'everyday',
    label: 'Everyday',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Home', hint: 'Shortcuts and what needs your attention' },
      { to: '/chats', icon: MessageSquare, label: 'Inbox', hint: 'Read and reply to WhatsApp chats' },
      { to: '/message-tester', icon: Send, label: 'Messages', hint: 'Send a message now or schedule one' },
      { to: '/group-contacts', icon: Contact, label: 'Contacts & groups', hint: 'Your contacts and WhatsApp groups' },
    ],
  },
  {
    id: 'grow',
    label: 'Grow & automate',
    items: [
      { to: '/campaigns', icon: Radio, label: 'Broadcasts', hint: 'Send one message to many people safely' },
      { to: '/automations', icon: Workflow, label: 'Automations', hint: 'Auto-replies and step-by-step flows' },
      { to: '/ai-chatbot', icon: Bot, label: 'AI Chatbot', hint: 'Let AI answer customer questions' },
      { to: '/lead-capture', icon: UserPlus, label: 'Lead Capture', hint: 'Collect customer details as leads' },
      { to: '/templates', icon: ClipboardList, label: 'Templates', hint: 'Save messages you send often' },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    items: [
      { to: '/sessions', icon: Smartphone, label: 'WhatsApp accounts', hint: 'Connect a number by scanning a QR code' },
      {
        to: '/api-keys',
        icon: Users,
        label: 'Team & access',
        hint: 'Add team members and set permissions',
        adminOnly: true,
      },
      { to: '/billing', icon: CreditCard, label: 'Subscription & billing', hint: 'Your plan, trial and payments' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    collapsible: true,
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Reports', hint: 'Charts and numbers for your accounts' },
      { to: '/webhooks', icon: Webhook, label: 'Webhooks', hint: 'Send events to other apps (for developers)' },
      { to: '/logs', icon: FileText, label: 'Activity log', hint: 'Everything that happened, with times' },
      // Backend /infra/* is ADMIN-only; hide the nav item from non-admins (UX + defense-in-depth).
      {
        to: '/infrastructure',
        icon: Server,
        label: 'Server settings',
        hint: 'Database, storage and engine settings',
        adminOnly: true,
      },
      { to: '/plugins', icon: Puzzle, label: 'Plugins', hint: 'Add extra features', adminOnly: true },
    ],
  },
];

const ADVANCED_OPEN_KEY = 'waply_nav_advanced_open';

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export function Layout({ onLogout, userRole }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
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
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { user, isSessionScoped } = useRole();
  const displayName = user?.name?.replace(/^user:/i, '') || null;
  const ThemeIcon = themeIcons[theme];
  const themeLabel = t(`theme.${theme}`);

  const visibleGroups = navGroups
    .map(group => ({ ...group, items: group.items.filter(item => !item.adminOnly || userRole === 'admin') }))
    .filter(group => group.items.length > 0);
  const isInAdvanced = navGroups
    .find(group => group.id === 'advanced')!
    .items.some(item => location.pathname.startsWith(item.to));

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleAdvanced = () =>
    setShowAdvanced(open => {
      try {
        localStorage.setItem(ADVANCED_OPEN_KEY, open ? '0' : '1');
      } catch {
        /* per-viewer convenience only */
      }
      return !open;
    });
  const advancedOpen = showAdvanced || isInAdvanced;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  // Show the build-time version immediately, then replace it with the live running version from the
  // backend so a stale-built bundle can't display the wrong number. Falls back silently on error.
  const [version, setVersion] = useState(__APP_VERSION__);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isLanguageMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsLanguageMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isLanguageMenuOpen]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);
  const languageLabel = languageOptions.find(option => option.value === currentLang)?.compactLabel ?? 'EN';
  const changeLanguage = (language: SupportedLanguage) => {
    setIsLanguageMenuOpen(false);
    void i18n.changeLanguage(language);
  };
  const isRtl = rtlLanguages.includes(currentLang);

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

      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''} ${isMobileOpen ? 'open' : ''}`}
      >
        <div className="sidebar-header">
          <div className="sidebar-logo-3d-wrapper">
            <img src="/waply-3d.png" alt="Waply" className="sidebar-logo-3d" />
          </div>
          {!isCollapsed && (
            <div className="sidebar-brand">
              <div className="brand-name-row">
                <span className="brand-name">{t('common.appName')}</span>
                <span className="brand-badge-pro">PRO</span>
              </div>
              <span className="brand-version">v{version}</span>
            </div>
          )}
        </div>

        {!isMobile && (
          <button
            className="collapse-toggle"
            onClick={toggleCollapse}
            title={isCollapsed ? t('common.expand') : t('common.collapse')}
            aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
          >
            {isCollapsed ? (
              isRtl ? (
                <ChevronLeft size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            ) : isRtl ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        )}

        <nav className="sidebar-nav">
          {visibleGroups.map(group => {
            const open = !group.collapsible || advancedOpen;
            return (
              <div className="nav-group" key={group.id}>
                {group.collapsible ? (
                  <button
                    className="nav-group-label nav-group-toggle"
                    onClick={toggleAdvanced}
                    aria-expanded={open}
                    title={isCollapsed ? group.label : 'Reports, developer and server tools'}
                  >
                    {isCollapsed ? <Wrench size={18} /> : <span>{group.label}</span>}
                    {!isCollapsed && <ChevronDown size={14} className={`nav-group-chevron ${open ? 'open' : ''}`} />}
                  </button>
                ) : (
                  !isCollapsed && <span className="nav-group-label">{group.label}</span>
                )}
                {open &&
                  group.items.map(({ to, icon: Icon, label, hint }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                      end={to === '/'}
                      onClick={handleNavClick}
                      title={isCollapsed ? `${label} — ${hint}` : hint}
                    >
                      <Icon size={20} />
                      {!isCollapsed && <span>{label}</span>}
                    </NavLink>
                  ))}
              </div>
            );
          })}
        </nav>

        {/* Current User Profile pill */}
        <div className={`sidebar-user-card ${isCollapsed ? 'collapsed' : ''}`}>
          <div className="user-avatar-circle">
            {(displayName ? displayName.slice(0, 2) : userRole ? userRole.slice(0, 2) : 'WA').toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="user-meta-info">
              <span className="user-display-name" title={displayName || undefined}>
                {displayName || (userRole === 'admin' ? 'Administrator' : 'Team Member')}
              </span>
              <div className="user-role-row">
                <span className={`user-role-badge ${userRole || 'viewer'}`}>{userRole?.toUpperCase() || 'VIEWER'}</span>
                {isSessionScoped && (
                  <span className="user-scope-tag" title={t('apiKeys.sessions.hint')}>
                    {user?.allowedSessions?.length
                      ? `${user.allowedSessions.length} Account${user.allowedSessions.length > 1 ? 's' : ''}`
                      : 'Scoped'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="language-menu" ref={languageMenuRef}>
            <button
              className="theme-toggle-btn"
              onClick={() => setIsLanguageMenuOpen(open => !open)}
              title={t('common.language')}
              aria-label={t('common.language')}
              aria-haspopup="menu"
              aria-expanded={isLanguageMenuOpen}
            >
              <Languages size={18} />
              {!isCollapsed && <span>{languageLabel}</span>}
            </button>
            {isLanguageMenuOpen && (
              <div className="language-menu-list" role="menu" aria-label={t('common.language')}>
                {languageOptions.map(option => (
                  <button
                    key={option.value}
                    className={`language-menu-item ${option.value === currentLang ? 'active' : ''}`}
                    onClick={() => changeLanguage(option.value)}
                    role="menuitemradio"
                    aria-checked={option.value === currentLang}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="appearance-menu">
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              title={t('theme.toggleTo', { value: t(resolvedTheme === 'dark' ? 'theme.light' : 'theme.dark') })}
              aria-label={t('theme.toggleTo', { value: t(resolvedTheme === 'dark' ? 'theme.light' : 'theme.dark') })}
            >
              <span className="appearance-button-cue" aria-hidden="true">
                <ThemeIcon size={16} />
              </span>
              {!isCollapsed && <span>{themeLabel}</span>}
            </button>
          </div>
          <button className="logout-btn" onClick={onLogout} title={isCollapsed ? t('common.logout') : undefined}>
            <LogOut size={20} />
            {!isCollapsed && <span>{t('common.logout')}</span>}
          </button>
        </div>
      </aside>

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
        {billing?.account?.status === 'trial' && location.pathname !== '/billing' && (
          <div className="trial-banner" role="status">
            <CreditCard size={16} />
            <span>
              You are on a free trial
              {billing.account.expiresAt &&
                ` until ${new Date(billing.account.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`}
              .
            </span>
            <NavLink to="/billing">Choose a plan →</NavLink>
          </div>
        )}
        {billing && !billing.access && userRole !== 'admin' && location.pathname !== '/billing' ? (
          <Navigate to="/billing" replace />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
