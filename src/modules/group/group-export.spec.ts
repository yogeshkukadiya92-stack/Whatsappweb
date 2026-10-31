import { GroupService } from './group.service';
import { GroupController } from './group.controller';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { GroupInfo, IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { SendPacingService } from '../message/send-pacing.service';

describe('group participant CSV exports', () => {
  const participant = (
    id: string,
    flags: { isAdmin?: boolean; isSuperAdmin?: boolean; name?: string; number?: string } = {},
  ) => ({ id, number: '', isAdmin: false, isSuperAdmin: false, ...flags });
  const setup = (engine: Partial<IWhatsAppEngine>) => {
    const registry = new EngineRegistry();
    registry.set('fixture', engine as IWhatsAppEngine);
    const service = new GroupService(registry, {} as SendPacingService);
    return { service, controller: new GroupController(service) };
  };
  it('escapes quoted names, preserves all participant roles and falls back to address numbers', async () => {
    const info: GroupInfo = {
      id: 'one@g.us',
      name: 'Team "A", Sales',
      participants: [
        participant('111@c.us', { name: 'Person "One"', number: '111', isSuperAdmin: true }),
        participant('222@c.us', { isAdmin: true }),
        participant('333@c.us'),
      ],
    };
    const engine = { getGroupInfo: jest.fn().mockResolvedValue(info) };
    const { controller } = setup(engine);
    const csv = await controller.exportParticipantsCsv('fixture', info.id);
    expect(csv).toBe(
      'Group Name,Participant Name,Mobile Number,WhatsApp ID,Role\n"Team ""A"", Sales","Person ""One""","111","111@c.us","Super Admin"\n"Team ""A"", Sales","","222","222@c.us","Admin"\n"Team ""A"", Sales","","333","333@c.us","Member"',
    );
    expect(engine.getGroupInfo).toHaveBeenCalledWith(info.id);
  });
  it('exports a valid header when group details omit participants or names', async () => {
    const engine = {
      getGroupInfo: jest.fn().mockResolvedValue({ id: 'one@g.us', participants: [participant('111@c.us')] }),
    };
    const { service } = setup(engine);
    expect(await service.exportGroupParticipantsCsv('fixture', 'one@g.us')).toContain(
      '\n"","","111","111@c.us","Member"',
    );
    engine.getGroupInfo.mockResolvedValueOnce({ id: 'one@g.us', name: 'Empty' });
    expect(await service.exportGroupParticipantsCsv('fixture', 'one@g.us')).toBe(
      'Group Name,Participant Name,Mobile Number,WhatsApp ID,Role',
    );
  });
  it('continues a multi-group export after a timeout and uses each group name fallback', async () => {
    const engine = {
      getGroups: jest
        .fn()
        .mockResolvedValue([
          { id: 'one@g.us', name: 'List "Name"' },
          { id: 'two@g.us', name: '' },
          { id: 'empty@g.us' },
          { id: 'missing@g.us' },
          { id: 'timeout@g.us' },
          { id: 'unnamed@g.us' },
        ]),
      getGroupInfo: jest
        .fn()
        .mockResolvedValueOnce({
          participants: [participant('1@c.us', { isSuperAdmin: true, number: '1', name: '"One"' })],
        })
        .mockResolvedValueOnce({ name: 'Detail Name', participants: [participant('2@c.us', { isAdmin: true })] })
        .mockResolvedValueOnce({ name: 'No participants' })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValueOnce({ participants: [participant('3@c.us')] }),
    };
    const { controller } = setup(engine);
    const csv = await controller.exportAllParticipantsCsv('fixture');
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv).toContain('"one@g.us","List ""Name""","""One""","1","1@c.us","Super Admin"');
    expect(csv).toContain('"two@g.us","Detail Name","","2","2@c.us","Admin"');
    expect(csv).toContain('"unnamed@g.us","","","3","3@c.us","Member"');
    expect(engine.getGroupInfo).toHaveBeenCalledTimes(6);
  });
  it('does not hide a missing session or a failure to enumerate groups', async () => {
    const { service } = setup({ getGroups: jest.fn().mockRejectedValue(new Error('engine disconnected')) });
    await expect(service.exportAllGroupsParticipantsCsv('fixture')).rejects.toThrow('engine disconnected');
    await expect(service.exportAllGroupsParticipantsCsv('missing')).rejects.toThrow('Session is not started');
  });
});
