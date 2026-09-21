import { DataSource, Repository } from 'typeorm';
import {
  ScheduledMessage,
  ScheduledMessageStatus,
} from './entities/scheduled-message.entity';
import { ScheduledMessageService } from './scheduled-message.service';
import { MessageService } from './message.service';
import { BulkMessageService } from './bulk-message.service';

describe('ScheduledMessageService', () => {
  let ds: DataSource;
  let repo: Repository<ScheduledMessage>;
  let messageService: Partial<MessageService>;
  let bulkMessageService: Partial<BulkMessageService>;
  let service: ScheduledMessageService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ScheduledMessage],
      synchronize: true,
    });
    await ds.initialize();
    repo = ds.getRepository(ScheduledMessage);

    messageService = {
      sendText: jest.fn().mockResolvedValue({ messageId: 'wa-msg-1' }),
      sendPoll: jest.fn().mockResolvedValue({ messageId: 'wa-poll-1' }),
      sendImage: jest.fn().mockResolvedValue({ messageId: 'wa-img-1' }),
    };

    bulkMessageService = {
      createBatch: jest.fn().mockResolvedValue({ batchId: 'batch-1' }),
    };

    service = new ScheduledMessageService(
      repo,
      messageService as MessageService,
      bulkMessageService as BulkMessageService,
    );
  });

  afterEach(async () => {
    service.onApplicationShutdown();
    if (ds.isInitialized) await ds.destroy();
  });

  describe('create and findAll', () => {
    it('creates and persists a scheduled message with normalized recipient', async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const item = await service.create('sess-1', {
        recipient: '12036301234567890',
        recipientType: 'group',
        messageType: 'poll',
        scheduledAt: future,
        details: {
          pollQuestion: 'Where to meet?',
          pollOptions: ['Office', 'Cafe'],
        },
      });

      expect(item.id).toBeDefined();
      expect(item.recipient).toBe('12036301234567890@g.us');
      expect(item.status).toBe(ScheduledMessageStatus.PENDING);
      expect(item.previewText).toContain('Poll: Where to meet?');

      const all = await service.findAll({ sessionId: 'sess-1' });
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(item.id);
    });

    it('filters by status', async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      await service.create('sess-1', {
        recipient: '628111@c.us',
        messageType: 'text',
        scheduledAt: future,
        details: { content: 'Test 1' },
      });

      const pending = await service.findAll({ status: 'pending' });
      expect(pending.length).toBe(1);

      const sent = await service.findAll({ status: 'sent' });
      expect(sent.length).toBe(0);
    });
  });

  describe('cancel and update', () => {
    it('cancels a scheduled message', async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const item = await service.create('sess-1', {
        recipient: '628111@c.us',
        messageType: 'text',
        scheduledAt: future,
        details: { content: 'To cancel' },
      });

      const cancelled = await service.cancel('sess-1', item.id);
      expect(cancelled.status).toBe(ScheduledMessageStatus.CANCELLED);

      const fetched = await service.findOne('sess-1', item.id);
      expect(fetched.status).toBe(ScheduledMessageStatus.CANCELLED);
    });

    it('updates a scheduled message content and date', async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const item = await service.create('sess-1', {
        recipient: '628111@c.us',
        messageType: 'text',
        scheduledAt: future,
        details: { content: 'Initial' },
      });

      const nextFuture = new Date(Date.now() + 7200_000).toISOString();
      const updated = await service.update('sess-1', item.id, {
        details: { content: 'Updated content' },
        scheduledAt: nextFuture,
      });

      expect(updated.previewText).toBe('Updated content');
      expect(updated.scheduledAt.toISOString()).toBe(new Date(nextFuture).toISOString());
    });
  });

  describe('dispatchMessage and recurrence', () => {
    it('dispatches a poll message to WhatsApp and updates status to sent', async () => {
      const item = await service.create('sess-1', {
        recipient: '120363@g.us',
        recipientType: 'group',
        messageType: 'poll',
        scheduledAt: new Date().toISOString(),
        details: {
          pollQuestion: 'Lunch pick?',
          pollOptions: ['Pizza', 'Sushi'],
        },
      });

      const res = await service.dispatchMessage(item);
      expect(res.success).toBe(true);
      expect(res.messageId).toBe('wa-poll-1');

      const saved = await service.findOne('sess-1', item.id);
      expect(saved.status).toBe(ScheduledMessageStatus.SENT);
      expect(saved.sentAt).toBeDefined();
      expect(messageService.sendPoll).toHaveBeenCalledWith('sess-1', {
        chatId: '120363@g.us',
        name: 'Lunch pick?',
        options: ['Pizza', 'Sushi'],
        allowMultipleAnswers: false,
      });
    });

    it('creates next recurring item on successful dispatch when recurrence is daily', async () => {
      const item = await service.create('sess-1', {
        recipient: '628111@c.us',
        messageType: 'text',
        scheduledAt: new Date('2026-10-01T10:00:00.000Z').toISOString(),
        details: { content: 'Daily reminder' },
        recurrence: {
          frequency: 'daily',
          time: '10:00',
        },
      });

      await service.dispatchMessage(item);

      const all = await service.findAll({ sessionId: 'sess-1' });
      expect(all.length).toBe(2);
      const pendingNext = all.find(i => i.id !== item.id);
      expect(pendingNext).toBeDefined();
      expect(pendingNext?.status).toBe(ScheduledMessageStatus.PENDING);
      expect(pendingNext?.scheduledAt.toISOString()).toContain('2026-10-02');
    });
  });

  describe('processDueMessages', () => {
    it('picks up due pending messages and dispatches them', async () => {
      // Past item (due)
      await service.create('sess-1', {
        recipient: '628111@c.us',
        messageType: 'text',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        details: { content: 'Due now' },
      });

      // Future item (not due)
      await service.create('sess-1', {
        recipient: '628222@c.us',
        messageType: 'text',
        scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
        details: { content: 'Later' },
      });

      await service.processDueMessages();

      const all = await service.findAll({ sessionId: 'sess-1' });
      const dueItem = all.find(i => i.details.content === 'Due now');
      const laterItem = all.find(i => i.details.content === 'Later');

      expect(dueItem?.status).toBe(ScheduledMessageStatus.SENT);
      expect(laterItem?.status).toBe(ScheduledMessageStatus.PENDING);
    });
  });
});
