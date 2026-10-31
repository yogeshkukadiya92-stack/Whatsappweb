import { SessionService } from '../../session/session.service';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { ApiKey } from '../entities/api-key.entity';

/** Pause engines on each node after entitlement expiry, including background automations. */
@Injectable()
export class BillingExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BillingExpiryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectRepository(User, 'main') private readonly users: Repository<User>,
    private readonly moduleRef: ModuleRef,
  ) {}
  onApplicationBootstrap() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sessions = this.moduleRef.get(SessionService, { strict: false });
      const expired = await this.users
        .createQueryBuilder('user')
        .where('user.role != :role', { role: 'admin' })
        .andWhere(
          '(user.isActive = :inactive OR user.subscriptionStatus NOT IN (:...statuses) OR user.subscriptionExpiresAt IS NULL OR user.subscriptionExpiresAt <= :now)',
          { inactive: false, statuses: ['active', 'trial'], now: new Date() },
        )
        .getMany();
      for (const user of expired) {
        if (!user.apiKeyId) continue;
        const key = await this.users.manager.findOneBy(ApiKey, { id: user.apiKeyId });
        for (const id of key?.allowedSessions ?? []) {
          if (!sessions.getEngine(id)) continue;
          try {
            await sessions.stop(id);
          } catch (error) {
            this.logger.warn(
              `Could not pause expired account session ${id}: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Subscription expiry sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
