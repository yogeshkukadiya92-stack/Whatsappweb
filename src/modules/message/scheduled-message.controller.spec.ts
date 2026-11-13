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
  it.each([
    [ApiKeyRole.OPERATOR, null, []],
    [ApiKeyRole.VIEWER, [], []],
    [ApiKeyRole.VIEWER, ['mine'], ['mine']],
    [ApiKeyRole.OPERATOR, ['mine'], ['mine']],
    [ApiKeyRole.ADMIN, ['mine'], ['mine']],
    [ApiKeyRole.ADMIN, [], undefined],
    [ApiKeyRole.ADMIN, null, undefined],
  ])('scopes summary for %s with sessions %j', async (role, allowedSessions, expected) => {
    const summary = { pendingCount: 0, upcoming: [] };
    const getSummary = jest.fn().mockResolvedValue(summary);
    const controller = new ScheduledMessageController({ getSummary } as unknown as ScheduledMessageService);
    expect(await controller.getSummary({ role, allowedSessions } as ApiKey)).toBe(summary);
    expect(getSummary).toHaveBeenCalledWith(expected);
  });

});
