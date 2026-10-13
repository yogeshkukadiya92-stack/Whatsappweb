import { ScheduledMessageController } from './scheduled-message.controller';
import { ScheduledMessageService } from './scheduled-message.service';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';

describe('ScheduledMessageController visibility', () => {
  it.each([
    [ApiKeyRole.OPERATOR, null, []],
    [ApiKeyRole.VIEWER, [], []],
    [ApiKeyRole.OPERATOR, ['mine'], ['mine']],
    [ApiKeyRole.ADMIN, ['mine'], ['mine']],
    [ApiKeyRole.ADMIN, null, undefined],
  ])('scopes %s with sessions %j', async (role, allowedSessions, expected) => {
    const findAll = jest.fn().mockResolvedValue([]);
    const controller = new ScheduledMessageController({ findAll } as unknown as ScheduledMessageService);
    await controller.listAll({ role, allowedSessions } as ApiKey, 'other', 'pending');
    expect(findAll).toHaveBeenCalledWith({ sessionId: 'other', status: 'pending', allowedSessions: expected });
  });
});
