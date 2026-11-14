import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { LoginIdentifiers, normalizeLoginIdentifiers } from './login-identifiers';

interface SupabaseUser {
  id: string;
  email?: string;
  phone?: string;
  user_metadata?: { name?: string; username?: string; preferred_username?: string; phone?: string };
  email_confirmed_at?: string | null;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SupabaseUser;
}

/** Public authentication uses the anon key; admin provisioning uses a server-only credential. */
@Injectable()
export class SupabaseAuthService {
  get enabled(): boolean {
    return Boolean(process.env.SUPABASE_AUTH_URL && process.env.SUPABASE_ANON_KEY);
  }

  private get baseUrl(): string {
    const configured = process.env.SUPABASE_AUTH_URL;
    if (!configured || !process.env.SUPABASE_ANON_KEY) {
      throw new ServiceUnavailableException('Supabase authentication is not configured');
    }
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ServiceUnavailableException('Supabase authentication URL is invalid');
    }
    return url.toString().replace(/\/$/, '');
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/auth/v1${path}`, {
        ...init,
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY!,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException('Supabase authentication is unavailable');
    }
  }

  private async resolveLogin(identifier: string): Promise<string> {
    const value = identifier.trim();
    if (value.includes('@')) return value.toLowerCase();
    const matches = await this.findLoginMatches(value);
    const user = matches.length === 1 ? matches[0] : undefined;
    if (!user?.email) throw new UnauthorizedException('Invalid login or password');
    return user.email;
  }

  private async findLoginMatches(value: string): Promise<SupabaseUser[]> {
    const phone = /^[+\d\s().-]+$/.test(value) ? value.replace(/[^\d]/g, '') : '';
    const matches = new Map<string, SupabaseUser>();
    // Resolve aliases on the server only; password verification still goes through Supabase.
    for (let page = 1; ; page++) {
      const response = await this.request(`/admin/users?page=${page}&per_page=100`, {
        method: 'GET',
        headers: this.adminHeaders(),
      });
      if (!response.ok) throw new ServiceUnavailableException('Login lookup is unavailable');
      const body = (await response.json()) as { users: SupabaseUser[] };
      if (!Array.isArray(body.users)) throw new ServiceUnavailableException('Login lookup is unavailable');
      for (const user of body.users) {
        const metadata = user.user_metadata;
        if (
          [metadata?.username, metadata?.preferred_username].some(
            alias => typeof alias === 'string' && alias.toLowerCase() === value.toLowerCase(),
          ) ||
          (phone &&
            [user.phone, metadata?.phone].some(
              number => typeof number === 'string' && number.replace(/[^\d]/g, '') === phone,
            ))
        ) {
          matches.set(user.id, user);
        }
      }
      if (body.users.length < 100) break;
    }
    return [...matches.values()];
  }

  private async ensureIdentifiersAvailable(identifiers: LoginIdentifiers): Promise<void> {
    for (const value of Object.values(identifiers)) {
      if ((await this.findLoginMatches(value)).length) {
        throw new ConflictException('Username or mobile number is already in use');
      }
    }
  }

  async signIn(identifier: string, password: string): Promise<SupabaseSession> {
    const email = await this.resolveLogin(identifier);
    const response = await this.request('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new UnauthorizedException('Invalid login or password');
    const session = (await response.json()) as SupabaseSession;
    if (!session.access_token || !session.refresh_token || !session.user?.id) {
      throw new UnauthorizedException('Supabase did not return a valid session');
    }
    if (!session.user.email_confirmed_at) {
      throw new UnauthorizedException('Confirm your email address before signing in');
    }
    return session;
  }

  private adminHeaders(): Record<string, string> {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'Admin user creation requires SUPABASE_SERVICE_ROLE_KEY in the Waply server configuration',
      );
    }
    return { apikey: key, Authorization: `Bearer ${key}` };
  }

  async createUser(
    email: string,
    password: string,
    name: string,
    values: LoginIdentifiers = {},
  ): Promise<SupabaseUser> {
    const identifiers = normalizeLoginIdentifiers(values);
    await this.ensureIdentifiersAvailable(identifiers);
    const response = await this.request('/admin/users', {
      method: 'POST',
      headers: this.adminHeaders(),
      body: JSON.stringify({ email, password, user_metadata: { name, ...identifiers }, email_confirm: true }),
    });
    if (!response.ok) {
      if (response.status === 422 || response.status === 409) {
        throw new ConflictException('This email already exists in Supabase or its account details are invalid');
      }
      throw new ServiceUnavailableException(
        'Could not create Supabase user. Check the server admin credential and Supabase availability.',
      );
    }
    const user = (await response.json()) as SupabaseUser;
    if (!user.id) throw new ServiceUnavailableException('Supabase did not return a user ID');
    return user;
  }

  async deleteCreatedUser(id: string): Promise<void> {
    const response = await this.request(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    });
    if (!response.ok) throw new ServiceUnavailableException('Could not roll back Supabase user creation');
  }

  async signUp(email: string, password: string, name: string, values: LoginIdentifiers = {}): Promise<void> {
    const identifiers = normalizeLoginIdentifiers(values);
    await this.ensureIdentifiersAvailable(identifiers);
    const response = await this.request('/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, data: { name, ...identifiers } }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { msg?: string; message?: string };
      throw new UnauthorizedException(body.msg || body.message || 'Could not create Supabase account');
    }
  }

  async refresh(refreshToken: string): Promise<SupabaseSession> {
    const response = await this.request('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) throw new UnauthorizedException('Supabase session has expired');
    const session = (await response.json()) as SupabaseSession;
    if (!session.access_token || !session.refresh_token || !session.user?.id) {
      throw new UnauthorizedException('Supabase did not return a valid session');
    }
    if (!session.user.email_confirmed_at) {
      throw new UnauthorizedException('Supabase email address is not verified');
    }
    return session;
  }

  async getUser(accessToken: string): Promise<SupabaseUser> {
    const response = await this.request('/user', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new UnauthorizedException('Supabase session is invalid');
    const user = (await response.json()) as SupabaseUser;
    if (!user.id || !user.email_confirmed_at) {
      throw new UnauthorizedException('Supabase email address is not verified');
    }
    return user;
  }
}
