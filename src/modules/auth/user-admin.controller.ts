import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { RegisterUserDto, SetUserPasswordDto } from './dto';
import { AuthService } from './auth.service';
import { ApiKeyRole } from './entities/api-key.entity';
import { SubscriptionPlan, SubscriptionStatus, User } from './entities/user.entity';
import { RequireRole, RequireUnscopedKey } from './decorators/auth.decorators';

class UpdateSubscriptionDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  maxSessions?: number;

  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsISO8601()
  subscriptionExpiresAt?: string | null;
}

@Controller('auth/users')
@RequireRole(ApiKeyRole.ADMIN)
@RequireUnscopedKey()
export class UserAdminController {
  constructor(private readonly auth: AuthService, private readonly audit: AuditService) {}

  @Post()
  async create(@Body() dto: RegisterUserDto) {
    const { passwordHash: _passwordHash, ...user } = await this.auth.createAdminUser(dto);
    return user;
  }

  @Get()
  async list(): Promise<Array<Omit<User, 'passwordHash'>>> {
    return (await this.auth.listUsers()).map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  @Patch(':id/password')
  async setPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserPasswordDto, @Req() req: Request) {
    await this.auth.setUserPassword(id, dto.password);
    await this.audit.logInfo(AuditAction.USER_PASSWORD_CHANGED, {
      method: req.method,
      path: req.path,
      ipAddress: (req as Request & { clientIp?: string }).clientIp,
      metadata: { targetUserId: id },
    });
    return { success: true };
  }

  @Patch(':id/subscription')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const { passwordHash: _passwordHash, ...user } = await this.auth.updateSubscription(id, dto);
    return user;
  }
}
