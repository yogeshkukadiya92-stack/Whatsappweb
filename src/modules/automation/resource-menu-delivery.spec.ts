import { DataSource } from 'typeorm';
import type { ModuleRef } from '@nestjs/core';
import { AutomationRulesService } from './automation-rules.service';
import { LeadFlowService } from './lead-flow.service';
import { AutomationRule } from './entities/automation-rule.entity';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('Resource menu delivery through the inbound automation pipeline', () => {
  let ds: DataSource;
  let automation: AutomationRulesService;
  const port = { sendText: jest.fn(), sendPoll: jest.fn(), sendDocument: jest.fn(), sendVideo: jest.fn() };
  beforeEach(async () => {
    jest.clearAllMocks();
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AutomationRule, LeadFlow, LeadEntry],
      synchronize: true,
    });
    await ds.initialize();
    await ds.getRepository(Session).save({ id: 'session', name: 'session', status: SessionStatus.READY, config: {} });
    const flows = new LeadFlowService(ds.getRepository(LeadFlow), ds.getRepository(LeadEntry));
    await flows.createFlow('session', {
      name: 'Resources',
      triggers: ['menu'],
      completionMessage: 'Not sent',
      steps: [
        {
          key: 'resource',
          question: 'Choose your resource',
          options: ['PDF', 'Video', 'Link'],
          deliveries: [
            { option: 'PDF', type: 'document', url: 'https://example.com/a.pdf', filename: 'guide.pdf' },
            { option: 'Video', type: 'video', url: 'https://example.com/a.mp4' },
            { option: 'Link', type: 'link', url: 'https://example.com/course', caption: 'Open here' },
          ],
        },
      ],
    });
    automation = new AutomationRulesService(
      ds.getRepository(AutomationRule),
      { get: () => port } as unknown as ModuleRef,
      undefined,
      undefined,
      flows,
    );
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it.each(['PDF', 'Video', 'Link'])('sends the menu and then only the selected %s delivery', async choice => {
    await automation.evaluateInbound('session', { chatId: 'customer@c.us', body: 'menu' });
    expect(port.sendPoll).toHaveBeenCalledWith('session', {
      chatId: 'customer@c.us',
      name: 'Choose your resource',
      options: ['PDF', 'Video', 'Link'],
      allowMultipleAnswers: false,
    });
    await automation.evaluateInbound('session', { chatId: 'customer@c.us', body: choice });
    if (choice === 'PDF') {
      expect(port.sendDocument).toHaveBeenCalledWith(
        'session',
        expect.objectContaining({ chatId: 'customer@c.us', url: 'https://example.com/a.pdf', filename: 'guide.pdf' }),
      );
      expect(port.sendVideo).not.toHaveBeenCalled();
    } else if (choice === 'Video') {
      expect(port.sendVideo).toHaveBeenCalledWith(
        'session',
        expect.objectContaining({ chatId: 'customer@c.us', url: 'https://example.com/a.mp4' }),
      );
      expect(port.sendDocument).not.toHaveBeenCalled();
    } else {
      expect(port.sendText).toHaveBeenLastCalledWith('session', {
        chatId: 'customer@c.us',
        text: 'Open here\nhttps://example.com/course',
      });
      expect(port.sendDocument).not.toHaveBeenCalled();
      expect(port.sendVideo).not.toHaveBeenCalled();
    }
    expect(port.sendPoll).toHaveBeenCalledTimes(1);
  });
});
