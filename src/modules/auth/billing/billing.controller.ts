import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Headers,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  IsInt,
  Min,
  Max,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  ArrayUnique,
  Matches,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { BillingService, BillingSettings, verifySignature } from './billing.service';
import { AuthService } from '../auth.service';
import { BillingRecovery, CurrentApiKey, Public, RequireRole, RequireUnscopedKey } from '../decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../entities/api-key.entity';
class PlanDto {
  @ApiProperty({ example: 'monthly' })
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  id!: string;
  @ApiProperty({ example: 'Monthly' })
  @IsString()
  @Matches(/^.{1,80}$/)
  name!: string;
  @ApiProperty({ enum: [1, 3, 6, 12] })
  @IsIn([1, 3, 6, 12])
  months!: number;
  @ApiProperty({ description: 'Price in INR', minimum: 1, maximum: 1000000, example: 299 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000)
  amount!: number;
  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  maxSessions!: number;
}
class SettingsDto implements BillingSettings {
  @ApiProperty({ minimum: 0, maximum: 365, example: 3 })
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays!: number;
  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  trialMaxSessions!: number;
  @ApiProperty({ type: () => [PlanDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((p: PlanDto) => p.id)
  @ValidateNested({ each: true })
  @Type(() => PlanDto)
  plans!: PlanDto[];
}
class CheckoutDto {
  @ApiProperty({ example: 'monthly' })
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  planId!: string;
}
class VerifyDto {
  @ApiProperty({ example: 'order_abc123' })
  @IsString()
  @Matches(/^order_[a-zA-Z0-9]+$/)
  orderId!: string;
  @ApiProperty({ example: 'pay_abc123' })
  @IsString()
  @Matches(/^pay_[a-zA-Z0-9]+$/)
  paymentId!: string;
  @ApiProperty({ description: 'Checkout signature returned by Razorpay', minLength: 64, maxLength: 64 })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  signature!: string;
}
@ApiTags('billing')
@BillingRecovery()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly auth: AuthService,
  ) {}
  private async account(key: ApiKey) {
    const user = await this.auth.findUserByApiKeyId(key.id);
    if (!user) throw new BadRequestException('A customer account is required');
    return user;
  }
  @Get('status')
  @ApiOperation({ summary: 'Get customer access, trial expiry and published plans' })
  async status(@CurrentApiKey() key: ApiKey) {
    const user = await this.auth.findUserByApiKeyId(key.id);
    const active =
      !!user &&
      user.isActive &&
      ['active', 'trial'].includes(user.subscriptionStatus) &&
      !!user.subscriptionExpiresAt &&
      user.subscriptionExpiresAt > new Date();
    return {
      settings: await this.billing.settings(),
      configured: this.billing.configured(),
      account: user
        ? {
            status: active ? user.subscriptionStatus : 'expired',
            expiresAt: user.subscriptionExpiresAt,
            plan: user.plan,
          }
        : null,
      access: user ? active : true,
    };
  }
  @Get('settings')
  @ApiOperation({ summary: 'Get administrator billing settings' })
  @RequireRole(ApiKeyRole.ADMIN)
  @RequireUnscopedKey()
  settings() {
    return this.billing.settings();
  }
  @Put('settings')
  @ApiOperation({ summary: 'Set trial duration and subscription prices' })
  @RequireRole(ApiKeyRole.ADMIN)
  @RequireUnscopedKey()
  save(@Body() dto: SettingsDto) {
    return this.billing.saveSettings(dto);
  }
  @Post('checkout')
  @ApiOperation({ summary: 'Create a Razorpay order for a published plan' })
  async checkout(@CurrentApiKey() key: ApiKey, @Body() dto: CheckoutDto) {
    return this.billing.checkout(await this.account(key), dto.planId);
  }
  @Post('verify')
  @ApiOperation({ summary: 'Verify a captured Razorpay payment and activate the purchased term' })
  async verify(@CurrentApiKey() key: ApiKey, @Body() dto: VerifyDto) {
    if (!verifySignature(`${dto.orderId}|${dto.paymentId}`, dto.signature, process.env.RAZORPAY_KEY_SECRET || ''))
      throw new UnauthorizedException('Invalid payment signature');
    return this.billing.confirm(dto.orderId, dto.paymentId, (await this.account(key)).id);
  }
  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Receive a signed Razorpay payment.captured webhook' })
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-razorpay-signature') signature: string) {
    if (!req.rawBody || !verifySignature(req.rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET || ''))
      throw new UnauthorizedException('Invalid webhook signature');
    const event = JSON.parse(req.rawBody.toString('utf8')) as {
      event?: unknown;
      payload?: { payment?: { entity?: { order_id?: unknown; id?: unknown } } };
    };
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (typeof payment?.order_id !== 'string' || typeof payment?.id !== 'string')
        throw new BadRequestException('Malformed payment event');
      await this.billing.handleCaptured(payment.order_id, payment.id);
    }
    return { received: true };
  }
}
