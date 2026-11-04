import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  Contact,
  Sparkles,
  PhoneCall,
  Workflow,
  UserPlus,
  BarChart3,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Check,
  Languages,
  MoreHorizontal,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { type UserRole, useRole } from '../hooks/useRole';
import { languageOptions, resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import type { BillingStatus } from '../services/api';
import './Sidebar.css';

type NavItem = { to: string; icon: typeof LayoutDashboard; label: string; hint: string; adminOnly?: boolean };
type NavSection = { id: string; label: string; collapsible?: boolean; items: NavItem[] };

// Grouped by what people come to do. Labels match each page's title; hints explain the tool in one line.
const sections: NavSection[] = [
  {
    id: 'everyday',
    label: 'Everyday',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Home', hint: 'Shortcuts and what needs your attention' },
      { to: '/chats', icon: MessageSquare, label: 'Inbox', hint: 'Read and reply to WhatsApp chats' },
      { to: '/message-tester', icon: Send, label: 'Messages', hint: 'Send now or schedule for later' },
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
      { to: '/sessions', icon: Smartphone, label: 'WhatsApp accounts', hint: 'Connect a number with a QR code' },
      { to: '/api-keys', icon: Users, label: 'Team & access', hint: 'Add people and set permissions', adminOnly: true },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    collapsible: true,
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Reports', hint: 'Charts and numbers for your accounts' },
      { to: '/webhooks', icon: Webhook, label: 'Webhooks', hint: 'Send events to other apps (developers)' },
      { to: '/logs', icon: FileText, label: 'Activity log', hint: 'Everything that happened, with times' },
      // Backend /infra/* is ADMIN-only; hide the nav item from non-admins (UX + defense-in-depth).
      {
        to: '/infrastructure',
        icon: Server,
        label: 'Server settings',
        hint: 'Database, storage and engine',
        adminOnly: true,
      },
      { to: '/plugins', icon: Puzzle, label: 'Plugins', hint: 'Add extra features', adminOnly: true },
    ],
  },
];

export const sidebarPageTitle = (pathname: string) => {
  if (pathname === '/billing') return 'Subscription & billing';
  if (pathname === '/setup-help') return 'Personal setup call';
  const all = sections.flatMap(section => section.items);
  return all.find(item => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)))?.label ?? '';
};

const ADVANCED_OPEN_KEY = 'waply_nav_advanced_open';
const DAY = 86_400_000;

interface SidebarProps {
  userRole: UserRole | null;
  isVisible: (path: string) => boolean;
  billing: BillingStatus | null;
  version: string;
  isCollapsed: boolean;
  isMobile: boolean;
  isOpen: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
  onLogout: () => void;
}

export function Sidebar({
  userRole,
  isVisible,
  billing,
  version,
  isCollapsed,
  isMobile,
  isOpen,
  onToggleCollapse,
  onNavigate,
  onLogout,
}: SidebarProps) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const { user, isSessionScoped } = useRole();
  const collapsed = isCollapsed && !isMobile;

  const visibleSections = sections
    .map(section => ({
      ...section,
      items: section.items.filter(item => (!item.adminOnly || userRole === 'admin') && isVisible(item.to)),
    }))
    .filter(section => section.items.length > 0);
  const inAdvanced = sections
    .find(section => section.id === 'advanced')!
    .items.some(item => pathname.startsWith(item.to));

  const [advancedPref, setAdvancedPref] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const advancedOpen = advancedPref || inAdvanced;
  const toggleAdvanced = () =>
    setAdvancedPref(open => {
      try {
        localStorage.setItem(ADVANCED_OPEN_KEY, open ? '0' : '1');
      } catch {
        /* per-viewer convenience only */
      }
      return !open;
    });

  // Keep the current page's menu item in view, e.g. an Advanced page below the fold.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector('.ws-link.active')?.scrollIntoView({ block: 'nearest' });
  }, [pathname, advancedOpen, billing]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) setLanguageOpen(false);
  }, [menuOpen]);

  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);
  const currentLangLabel = languageOptions.find(option => option.value === currentLang)?.label ?? 'English';
  const changeLanguage = (language: SupportedLanguage) => {
    setMenuOpen(false);
    void i18n.changeLanguage(language);
  };

  const displayName = user?.name?.replace(/^user:/i, '') || (userRole === 'admin' ? 'Administrator' : 'Team member');
  const nameParts = displayName.split(/[\s._@-]+/).filter(Boolean);
  const initials = (
    nameParts.length > 1 ? nameParts[0][0] + nameParts[1][0] : (nameParts[0] ?? '').slice(0, 2)
  ).toUpperCase();
  const roleLabel = userRole === 'admin' ? 'Admin' : userRole === 'operator' ? 'Operator' : 'Viewer';
  const scopeLabel = isSessionScoped
    ? user?.allowedSessions?.length
      ? `${user.allowedSessions.length} account${user.allowedSessions.length > 1 ? 's' : ''}`
      : 'Limited access'
    : null;

  const account = billing?.account;
  const daysLeft = account?.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(account.expiresAt) - Date.now()) / DAY))
    : null;
  const plan =
    account?.status === 'trial'
      ? {
          tone: daysLeft !== null && daysLeft <= 3 ? 'warn' : 'trial',
          title: 'Free trial',
          detail:
            daysLeft === null
              ? 'Choose a plan any time'
              : daysLeft === 0
                ? 'Ends today'
                : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
          cta: 'Upgrade',
          progress:
            daysLeft !== null && billing?.settings?.trialDays
              ? Math.min(1, daysLeft / billing.settings.trialDays)
              : null,
        }
      : billing?.access
        ? {
            tone: 'active',
            title: account?.plan ? `${account.plan} plan` : 'Active plan',
            detail:
              daysLeft !== null ? `Renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Subscription & billing',
            cta: 'Manage',
            progress: null,
          }
        : billing
          ? { tone: 'warn', title: 'Plan expired', detail: 'Renew to keep sending', cta: 'Renew', progress: null }
          : null;

  return (
    <aside
      className={`sidebar ws-sidebar ${collapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''} ${isOpen ? 'open' : ''}`}
      aria-label="Main menu"
    >
      <div className="ws-brand">
        <img src="/waply-3d.png" alt="" className="ws-brand-logo" />
        {!collapsed && (
          <div className="ws-brand-text">
            <span className="ws-brand-name">{t('common.appName')}</span>
            <span className="ws-brand-version">v{version}</span>
          </div>
        )}
        {!isMobile && (
          <button
            className="ws-icon-btn ws-collapse"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
      </div>

      <nav className="ws-nav" ref={navRef}>
        {visibleSections.map(section => {
          const open = !section.collapsible || advancedOpen;
          return (
            <div className="ws-section" key={section.id}>
              {section.collapsible ? (
                <button
                  className="ws-section-label ws-section-toggle"
                  onClick={toggleAdvanced}
                  aria-expanded={open}
                  title={collapsed ? 'Advanced tools' : 'Reports, developer and server tools'}
                >
                  {collapsed ? <MoreHorizontal size={18} /> : <span>{section.label}</span>}
                  {!collapsed && <ChevronDown size={14} className={`ws-chevron ${open ? 'open' : ''}`} />}
                </button>
              ) : (
                !collapsed && <span className="ws-section-label">{section.label}</span>
              )}
              {open &&
                section.items.map(({ to, icon: Icon, label, hint }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) => `ws-link ${isActive ? 'active' : ''}`}
                    title={collapsed ? `${label} — ${hint}` : hint}
                  >
                    <span className="ws-link-icon">
                      <Icon size={18} />
                    </span>
                    {!collapsed && <span className="ws-link-label">{label}</span>}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>

      <div className="ws-bottom">
        {plan && (
          <NavLink
            to="/billing"
            onClick={onNavigate}
            className={({ isActive }) => `ws-plan ${plan.tone} ${isActive ? 'active' : ''}`}
            title={`${plan.title} · ${plan.detail}`}
          >
            <span className="ws-plan-icon">
              <Sparkles size={16} />
            </span>
            {!collapsed && (
              <>
                <span className="ws-plan-text">
                  <strong>{plan.title}</strong>
                  <small>{plan.detail}</small>
                </span>
                <span className="ws-plan-cta">{plan.cta}</span>
                {plan.progress !== null && (
                  <span className="ws-plan-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(plan.progress * 100)}%` }} />
                  </span>
                )}
              </>
            )}
          </NavLink>
        )}

        <NavLink
          to="/setup-help"
          onClick={onNavigate}
          className={({ isActive }) => `ws-help ${isActive ? 'active' : ''}`}
          title="Book a free call and we'll help you set up"
        >
          <PhoneCall size={16} />
          {!collapsed && <span>Need help? Book a setup call</span>}
        </NavLink>

        <div className="ws-account" ref={menuRef}>
          <button
            className="ws-account-btn"
            onClick={() => setMenuOpen(open => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={collapsed ? `${displayName} · ${roleLabel}` : 'Account, language and theme'}
          >
            <span className="ws-avatar">{initials || 'WA'}</span>
            {!collapsed && (
              <>
                <span className="ws-account-text">
                  <strong>{displayName}</strong>
                  <small>
                    {roleLabel}
                    {scopeLabel && ` · ${scopeLabel}`}
                  </small>
                </span>
                <MoreHorizontal size={16} className="ws-account-more" />
              </>
            )}
          </button>

          {menuOpen && (
            <div className="ws-menu" role="menu">
              {languageOpen ? (
                <>
                  <button className="ws-menu-item ws-menu-back" onClick={() => setLanguageOpen(false)} role="menuitem">
                    <ChevronsLeft size={16} />
                    {t('common.language')}
                  </button>
                  <div className="ws-menu-scroll">
                    {languageOptions.map(option => (
                      <button
                        key={option.value}
                        className="ws-menu-item"
                        onClick={() => changeLanguage(option.value)}
                        role="menuitemradio"
                        aria-checked={option.value === currentLang}
                      >
                        <span>{option.label}</span>
                        {option.value === currentLang && <Check size={16} className="ws-menu-check" />}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <button className="ws-menu-item" onClick={() => setLanguageOpen(true)} role="menuitem">
                    <Languages size={16} />
                    <span>{t('common.language')}</span>
                    <span className="ws-menu-value">{currentLangLabel}</span>
                  </button>
                  <button
                    className="ws-menu-item"
                    onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                    role="menuitem"
                  >
                    {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    <span>{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                  </button>
                  <div className="ws-menu-divider" />
                  <button className="ws-menu-item danger" onClick={onLogout} role="menuitem">
                    <LogOut size={16} />
                    <span>{t('common.logout')}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
