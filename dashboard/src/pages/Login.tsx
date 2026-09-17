import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Languages, Lock, Mail, User as UserIcon, ArrowRight, ShieldCheck, Sparkles, Zap, Cpu } from 'lucide-react';
import { CustomSelect } from '../components/CustomSelect';
import { languageOptions, resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import { API_BASE_URL, userAuthApi } from '../services/api';
import { AmbientCanvas } from '../components/AmbientCanvas';
import { TiltCard } from '../components/TiltCard';
import './Login.css';

interface LoginProps {
  onLogin: (apiKey: string, role?: string, name?: string, allowedSessions?: string[] | null) => void;
}

type AuthMode = 'signin' | 'signup' | 'apikey';

export function Login({ onLogin }: LoginProps) {
  const { t, i18n } = useTranslation();
  const [authMode, setAuthMode] = useState<AuthMode>('apikey');

  // Sign In / Sign Up fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // API Key mode field
  const [apiKey, setApiKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);

  const changeLanguage = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError(t('login.apiKeyRequired'));
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      });

      if (response.ok) {
        // The validate body already carries the key's role, name, and allowedSessions
        const data: { role?: string; name?: string; allowedSessions?: string[] | null } = await response
          .json()
          .catch(() => ({}));
        onLogin(apiKey, data.role, data.name, data.allowedSessions);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.message || t('login.invalidKey'));
      }
    } catch {
      setError(t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter both email and password');
      return;
    }

    if (authMode === 'signup') {
      if (!fullName.trim()) {
        setError('Please enter your full name');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters long');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (authMode === 'signup') {
        const res = await userAuthApi.register({
          email,
          password,
          name: fullName,
        });
        // Use the generated token / proxy key to log in
        onLogin(res.token, res.user.role, res.user.name, null);
      } else {
        const res = await userAuthApi.login({
          email,
          password,
        });
        onLogin(res.token, res.user.role, res.user.name, null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <AmbientCanvas particleCount={48} accentColor="#25d366" secondaryColor="#06b6d4" />
      <div className="login-glow-bg" />

      <TiltCard maxTilt={5} className="login-tilt-container">
        <div className="login-card luxury-card">
          <div className="login-logo">
            <div className="logo-3d-graphic-wrapper">
              <img src="/waply-3d.png" alt="Waply 3D Emblem" className="logo-3d-emblem" />
            </div>
            <div className="logo-badge-wrapper">
              <img src="/waply-logo.png" alt="Waply" className="logo-icon" />
              <span className="saas-badge">
                <Sparkles size={11} /> Cloud Pro
              </span>
            </div>
            <span className="version-info">
              {t('login.version', {
                version: __APP_VERSION__,
                date: new Date(__BUILD_TIME__).toISOString().slice(0, 10).replace(/-/g, ''),
              })}
            </span>
          </div>

        <div className="login-language">
          <Languages size={18} />
          <CustomSelect
            value={currentLang}
            onChange={value => changeLanguage(value as SupportedLanguage)}
            options={languageOptions.map(opt => ({ value: opt.value, label: opt.label }))}
            ariaLabel={t('common.language')}
          />
        </div>

        {/* Segmented Auth Mode Switcher */}
        <div className="auth-tab-bar" role="tablist">
          <button
            type="button"
            className={`auth-tab-btn ${authMode === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('signin');
              setError('');
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${authMode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('signup');
              setError('');
            }}
          >
            Create Account
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${authMode === 'apikey' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('apikey');
              setError('');
            }}
          >
            API Key
          </button>
        </div>

        {error && <div className="auth-alert-error">{error}</div>}

        {authMode === 'apikey' ? (
          <form onSubmit={handleApiKeySubmit} className="login-form">
            <div className="input-group">
              <label htmlFor="apiKey">{t('login.apiKey')}</label>
              <div className="input-wrapper">
                <input
                  id="apiKey"
                  type={showPassword ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={t('login.apiKeyPlaceholder')}
                  className={error ? 'error' : ''}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('common.hideApiKey') : t('common.showApiKey')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="connect-btn" disabled={isLoading}>
              {isLoading ? t('login.connecting') : t('login.connect')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleUserAuthSubmit} className="login-form">
            {authMode === 'signup' && (
              <div className="input-group">
                <label htmlFor="fullName">Full Name</label>
                <div className="input-wrapper icon-padded">
                  <UserIcon size={17} className="field-icon" />
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    required
                  />
                </div>
              </div>
            )}

            <div className="input-group">
              <label htmlFor="email">Email Address</label>
              <div className="input-wrapper icon-padded">
                <Mail size={17} className="field-icon" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper icon-padded">
                <Lock size={17} className="field-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="input-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="input-wrapper icon-padded">
                  <Lock size={17} className="field-icon" />
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                </div>
              </div>
            )}

            <button type="submit" className="connect-btn" disabled={isLoading}>
              {isLoading ? (
                'Processing...'
              ) : authMode === 'signup' ? (
                <>
                  Create Free Account <ArrowRight size={17} />
                </>
              ) : (
                <>
                  Sign In to Dashboard <ArrowRight size={17} />
                </>
              )}
            </button>

            <div className="auth-subtext-guarantee">
              <ShieldCheck size={14} /> End-to-end encrypted session credentials
            </div>
          </form>
        )}

          {/* Micro-features showcase */}
          <div className="login-feature-strip">
            <div className="feature-chip">
              <Zap size={12} className="feature-icon" />
              <span>12ms Ultra-Core</span>
            </div>
            <div className="feature-chip">
              <ShieldCheck size={12} className="feature-icon" />
              <span>Multi-Tenant E2EE</span>
            </div>
            <div className="feature-chip">
              <Cpu size={12} className="feature-icon" />
              <span>AI Automation</span>
            </div>
          </div>
        </div>
      </TiltCard>
    </div>
  );
}
