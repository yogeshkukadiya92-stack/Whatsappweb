import { SubscriptionAccessService } from './billing/subscription-access.service';
import { BillingExpiryService } from './billing/billing-expiry.service';
import { BillingRecord } from './entities/billing-record.entity';
import { BillingService } from './billing/billing.service';
import { BillingController } from './billing/billing.controller';
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ApiKey } from './entities/api-key.entity';
import { User } from './entities/user.entity';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { AuthController } from './auth.controller';
import { AuthValidateController } from './auth-validate.controller';
import { UserAuthController } from './user-auth.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ProxyAwareThrottlerGuard } from '../../common/security/proxy-aware-throttler.guard';
import { SupabaseAuthController } from './supabase-auth.controller';
import { SupabaseAuthService } from './supabase-auth.service';
import { UserAdminController } from './user-admin.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User, BillingRecord], 'main')],
  controllers: [
    BillingController,
    AuthController,
    AuthValidateController,
    UserAuthController,
    UserAdminController,
    SupabaseAuthController,
  ],
  providers: [
    AuthService,
    BillingService,
    SubscriptionAccessService,
    BillingExpiryService,
    SupabaseAuthService,
    ApiKeyUsageTracker,
    {
      provide: APP_GUARD,
      useClass: ProxyAwareThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [AuthService, SubscriptionAccessService],
})
export class AuthModule {}
