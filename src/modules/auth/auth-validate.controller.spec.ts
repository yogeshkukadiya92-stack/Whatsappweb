import { AuthValidateController } from './auth-validate.controller';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';

describe('AuthValidateController', () => {
  const controller = new AuthValidateController();

  const makeKey = (over: Partial<ApiKey> = {}): ApiKey =>
    ({ id: 'k1', role: ApiKeyRole.OPERATOR, isActive: true, allowedIps: null, ...over }) as ApiKey;

  it('reports the guard-validated key as valid, echoing its role, name, and allowedSessions', () => {
    expect(
      controller.validate(
        makeKey({ role: ApiKeyRole.ADMIN, name: 'Admin Key', allowedSessions: ['sess-1'] }),
      ),
    ).toEqual({
      valid: true,
      role: ApiKeyRole.ADMIN,
      name: 'Admin Key',
      allowedSessions: ['sess-1'],
    });
  });

  it('returns valid:true for an IP-restricted key (no IP-less re-validation false negative)', () => {
    // The global guard already validated this key against the real client IP and attached it.
    // The handler must NOT re-validate without an IP, which previously fail-closed and wrongly
    // reported valid:false for any key carrying an allowedIps restriction.
    const key = makeKey({ allowedIps: ['10.0.0.0/24'], name: 'Operator Key' });
    expect(controller.validate(key)).toEqual({
      valid: true,
      role: key.role,
      name: 'Operator Key',
      allowedSessions: undefined,
    });
  });

  it('returns valid:false when no key is attached (defense-in-depth)', () => {
    expect(controller.validate(undefined)).toEqual({ valid: false });
  });
});
