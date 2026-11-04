import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { ApiKey } from '../entities/api-key.entity';

/** Also protects internal senders and session auto-wake paths, which do not run HTTP guards. */
@Injectable()
export class SubscriptionAccessService {
  constructor(
    @InjectRepository(User, 'main') private readonly users: Repository<User>,
    @InjectRepository(ApiKey, 'main') private readonly keys: Repository<ApiKey>,
  ) {}

  async assertSessionAccess(sessionId: string): Promise<void> {
    const candidates = await this.keys.find({ where: { allowedSessions: Like(`%${sessionId}%`) } });
    const owners = candidates.filter(key => key.allowedSessions?.includes(sessionId)).map(key => key.id);
    // Legacy administrator-managed sessions have no customer subscription attached.
    if (!owners.length) return;
    const accounts = await this.users.find({ where: { apiKeyId: In(owners) } });
    const now = new Date();
    if (
      accounts.some(
        account =>
          account.role !== UserRole.ADMIN &&
          (!account.isActive ||
            !['active', 'trial'].includes(account.subscriptionStatus) ||
            !account.subscriptionExpiresAt ||
            account.subscriptionExpiresAt <= now),
      )
    ) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your trial or subscription has ended. Please choose a plan.',
      });
    }
  }
}
