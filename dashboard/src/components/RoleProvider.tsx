import { useState, useCallback, type ReactNode } from 'react';
import type { UserRole, UserProfile, RoleContextType } from '../types/role';
import { RoleContext } from '../hooks/useRole';

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<UserRole | null>(() => {
    const saved = localStorage.getItem('openwa_user_role');
    return (saved as UserRole) || null;
  });

  const [user, setUserState] = useState<UserProfile | null>(() => {
    const savedName = localStorage.getItem('openwa_user_name');
    const savedRole = localStorage.getItem('openwa_user_role') as UserRole | null;
    const savedSessions = localStorage.getItem('openwa_allowed_sessions');
    if (!savedRole && !savedName) return null;
    return {
      name: savedName || null,
      role: savedRole || null,
      allowedSessions: savedSessions ? JSON.parse(savedSessions) : null,
    };
  });

  const setRole = useCallback((newRole: UserRole | null) => {
    setRoleState(newRole);
    if (newRole) {
      localStorage.setItem('openwa_user_role', newRole);
    } else {
      localStorage.removeItem('openwa_user_role');
    }
  }, []);

  const setUser = useCallback((newUser: UserProfile | null) => {
    setUserState(newUser);
    if (newUser) {
      if (newUser.role) localStorage.setItem('openwa_user_role', newUser.role);
      if (newUser.name) localStorage.setItem('openwa_user_name', newUser.name);
      if (newUser.allowedSessions) {
        localStorage.setItem('openwa_allowed_sessions', JSON.stringify(newUser.allowedSessions));
      } else {
        localStorage.removeItem('openwa_allowed_sessions');
      }
    } else {
      localStorage.removeItem('openwa_user_role');
      localStorage.removeItem('openwa_user_name');
      localStorage.removeItem('openwa_allowed_sessions');
    }
  }, []);

  const isSessionScoped = Boolean(
    role !== 'admin' || (user?.allowedSessions && user.allowedSessions.length > 0),
  );

  const value: RoleContextType = {
    role,
    user,
    setRole,
    setUser,
    isAdmin: role === 'admin',
    isOperator: role === 'operator',
    isViewer: role === 'viewer',
    canWrite: role === 'admin' || role === 'operator',
    isSessionScoped,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
