import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { RegisterUserDto } from './dto';
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
  private publicAccount(user: User): Omit<User, 'passwordHash'> {
    const safe = { ...user };
    Reflect.deleteProperty(safe, 'passwordHash');
    return safe;
  }

  constructor(private readonly auth: AuthService) {}

  @Post()
  async create(@Body() dto: RegisterUserDto) {
    return this.publicAccount(await this.auth.createAdminUser(dto));
  }

  @Get()
  async list(): Promise<Array<Omit<User, 'passwordHash'>>> {
    return (await this.auth.listUsers()).map(user => this.publicAccount(user));
  }

  @Patch(':id/subscription')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    return this.publicAccount(await this.auth.updateSubscription(id, dto));
  }
}
