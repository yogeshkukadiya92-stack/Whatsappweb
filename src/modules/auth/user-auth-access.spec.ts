import { ForbiddenException } from '@nestjs/common';
import { UserAuthController } from './user-auth.controller';
import { UserAdminController } from './user-admin.controller';
import { AuthService } from './auth.service';
import { PUBLIC_KEY, REQUIRED_ROLE_KEY, UNSCOPED_KEY } from './decorators/auth.decorators';

describe('Dashboard account provisioning', () => {
  const previous = process.env.DASHBOARD_SIGNUP_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.DASHBOARD_SIGNUP_ENABLED;
    else process.env.DASHBOARD_SIGNUP_ENABLED = previous;
  });
  const dto = { name: 'Client', email: 'client@example.com', password: 'a-long-password' };
  it('blocks public registration when explicitly disabled', async () => {
    process.env.DASHBOARD_SIGNUP_ENABLED = 'false';
    const register = jest.fn();
    const controller = new UserAuthController({ register } as unknown as AuthService);
    expect(controller.status()).toEqual({ signupEnabled: false });
    await expect(controller.register(dto)).rejects.toThrow(ForbiddenException);
    expect(register).not.toHaveBeenCalled();
  });
  it.each([undefined, 'true'])('allows public signup with setting %s', async setting => {
    if (setting === undefined) delete process.env.DASHBOARD_SIGNUP_ENABLED;
    else process.env.DASHBOARD_SIGNUP_ENABLED = setting;
    const register = jest.fn().mockResolvedValue({ token: 'token' });
    const controller = new UserAuthController({ register } as unknown as AuthService);
    expect(controller.status()).toEqual({ signupEnabled: true });
    await controller.register(dto);
    expect(register).toHaveBeenCalledWith(dto);
  });
  it('requires an unscoped administrator and does not return client credentials', async () => {
    expect(Reflect.getMetadata(REQUIRED_ROLE_KEY, UserAdminController)).toBe('admin');
    expect(Reflect.getMetadata(UNSCOPED_KEY, UserAdminController)).toBe(true);
    expect(
      Reflect.getMetadata(
        PUBLIC_KEY,
        Object.getOwnPropertyDescriptor(UserAdminController.prototype, 'create')?.value as object,
      ),
    ).toBeUndefined();
    const createAdminUser = jest.fn().mockResolvedValue({ id: 'id', passwordHash: 'secret-hash' });
    const controller = new UserAdminController({ createAdminUser } as unknown as AuthService);
    expect(await controller.create(dto)).toEqual({ id: 'id' });
    expect(createAdminUser).toHaveBeenCalledWith(dto);
  });
});
