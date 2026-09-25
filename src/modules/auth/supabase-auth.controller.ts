import { Body, Controller, Get, Post, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { CurrentApiKey, Public } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';
import { LoginUserDto, RegisterUserDto } from './dto';

class RefreshSupabaseDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

@Controller('auth/supabase')
export class SupabaseAuthController {
  constructor(
    private readonly supabase: SupabaseAuthService,
    private readonly auth: AuthService,
  ) {}

  private requireEnabled(): void {
    if (!this.supabase.enabled) throw new ServiceUnavailableException('Supabase authentication is not configured');
  }

  private async profile(session: Awaited<ReturnType<SupabaseAuthService['signIn']>>) {
    const key = await this.auth.findSupabaseKey(session.user.id);
    return {
      token: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
      role: key.role,
      name: key.name,
      allowedSessions: key.allowedSessions,
    };
  }

  @Public()
  @Get('status')
  status() {
    return { enabled: this.supabase.enabled, signupEnabled: process.env.SUPABASE_SIGNUP_ENABLED === 'true' };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginUserDto) {
    this.requireEnabled();
    return this.profile(await this.supabase.signIn(dto.email, dto.password));
  }

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: RegisterUserDto) {
    this.requireEnabled();
    if (process.env.SUPABASE_SIGNUP_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Email signup is disabled until confirmation email is configured');
    }
    await this.supabase.signUp(dto.email, dto.password, dto.name);
    return { message: 'Check your email, then sign in and link your Waply API key.' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshSupabaseDto) {
    this.requireEnabled();
    return this.profile(await this.supabase.refresh(dto.refreshToken));
  }

  /** The holder of an existing Waply key can attach a verified Supabase identity to it. */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  async link(@CurrentApiKey() key: ApiKey, @Body() dto: LoginUserDto) {
    this.requireEnabled();
    const session = await this.supabase.signIn(dto.email, dto.password);
    await this.auth.linkSupabaseIdentity(key, session.user.id);
    return this.profile(session);
  }
}
