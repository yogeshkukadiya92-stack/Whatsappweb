import { BadRequestException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AuthService } from '../auth.service';
import { ApiKey, ApiKeyRole } from '../entities/api-key.entity';
import { User } from '../entities/user.entity';
import { REQUIRED_ROLE_KEY, UNSCOPED_KEY, PUBLIC_KEY } from '../decorators/auth.decorators';

describe('billing setup calls', () => {
  it('binds a setup call to the authenticated account, ignoring an injected account id', async () => {
    const user = { id: 'mine', email: 'mine@example.test' } as User;
    const findUserByApiKeyId = jest.fn().mockResolvedValue(user);
    const requestCall = jest.fn().mockResolvedValue({ phone: '+919876543210' });
    const controller = new BillingController(
      { requestCall } as unknown as BillingService,
      { findUserByApiKeyId } as unknown as AuthService,
    );
    const payload = { phone: '+919876543210', userId: 'other' };
    await controller.requestCall({ id: 'my-key' } as ApiKey, payload);
    expect(findUserByApiKeyId).toHaveBeenCalledWith('my-key');
    expect(requestCall).toHaveBeenCalledWith(user, payload.phone);
  });

  it('rejects a key without a linked customer account before recording a call', async () => {
    const requestCall = jest.fn();
    const controller = new BillingController(
      { requestCall } as unknown as BillingService,
      { findUserByApiKeyId: jest.fn().mockResolvedValue(null) } as unknown as AuthService,
    );
    await expect(
      controller.requestCall({ id: 'unlinked' } as ApiKey, { phone: '+919876543210' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestCall).not.toHaveBeenCalled();
  });

  it('keeps setup call lists and completion restricted to unrestricted administrators', () => {
    for (const handler of [BillingController.prototype.setupCalls, BillingController.prototype.completeCall]) {
      expect(Reflect.getMetadata(REQUIRED_ROLE_KEY, handler)).toBe(ApiKeyRole.ADMIN);
      expect(Reflect.getMetadata(UNSCOPED_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_KEY, handler)).not.toBe(true);
    }
    expect(Reflect.getMetadata(PUBLIC_KEY, BillingController.prototype.requestCall)).not.toBe(true);
  });
});
