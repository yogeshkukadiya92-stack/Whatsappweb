// Role types for RBAC
export type UserRole = 'admin' | 'operator' | 'viewer';

export interface UserProfile {
  name: string | null;
  role: UserRole | null;
  allowedSessions: string[] | null;
}

export interface RoleContextType {
  role: UserRole | null;
  user: UserProfile | null;
  setRole: (role: UserRole | null) => void;
  setUser: (user: UserProfile | null) => void;
  isAdmin: boolean;
  isOperator: boolean;
  isViewer: boolean;
  canWrite: boolean;
  isSessionScoped: boolean;
}
