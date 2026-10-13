import { generateToken, verifyToken } from './user-crypto';

describe('Dashboard tokens', () => {
  const previous = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'unique-test-installation-secret-123456789';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const payload = {
    userId: 'user',
    apiKeyId: 'key',
    email: 'client@example.com',
    role: 'user',
    subscriptionStatus: 'trial',
    plan: 'starter',
  };
  it('accepts its own tokens and rejects tampering and other installation secrets', () => {
    const token = generateToken(payload);
    expect(verifyToken(token)?.userId).toBe('user');
    expect(verifyToken(token + 'x')).toBeNull();
    process.env.JWT_SECRET = 'another-installation-secret-123456789';
    expect(verifyToken(token)).toBeNull();
  });
  it('rejects expired tokens', () => {
    const token = generateToken(payload);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 86400 * 1000);
    expect(verifyToken(token)).toBeNull();
  });
});
