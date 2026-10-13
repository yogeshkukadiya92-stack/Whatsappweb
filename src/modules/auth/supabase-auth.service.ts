import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

interface SupabaseUser {
  id: string;
  email?: string;
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

  async signIn(email: string, password: string): Promise<SupabaseSession> {
    const response = await this.request('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new UnauthorizedException('Invalid email or password');
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

  async createUser(email: string, password: string, name: string): Promise<SupabaseUser> {
    const response = await this.request('/admin/users', {
      method: 'POST',
      headers: this.adminHeaders(),
      body: JSON.stringify({ email, password, user_metadata: { name }, email_confirm: true }),
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

  async signUp(email: string, password: string, name: string): Promise<void> {
    const response = await this.request('/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, data: { name } }),
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
