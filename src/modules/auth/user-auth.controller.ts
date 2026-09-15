import { Controller, Post, Get, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterUserDto, LoginUserDto, AuthResponseDto } from './dto';
import { Public, CurrentApiKey } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';

@ApiTags('auth')
@Controller('auth')
export class UserAuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new SaaS client user account' })
  @ApiResponse({ status: 201, description: 'User account created', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() dto: RegisterUserDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with Email and Password' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(@Body() dto: LoginUserDto): Promise<AuthResponseDto> {
    return this.authService.userLogin(dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and subscription status' })
  async getProfile(@CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request) {
    if (!apiKey) {
      return null;
    }
    const user = await this.authService.findUserByApiKeyId(apiKey.id);
    return {
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        role: apiKey.role,
        allowedSessions: apiKey.allowedSessions,
      },
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            subscriptionStatus: user.subscriptionStatus,
            plan: user.plan,
            maxSessions: user.maxSessions,
            subscriptionExpiresAt: user.subscriptionExpiresAt,
          }
        : null,
    };
  }
}
