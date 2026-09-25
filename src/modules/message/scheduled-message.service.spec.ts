import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { EngineStatus } from '../../engine/interfaces/whatsapp-engine.interface';
import { EngineNotReadyError } from '../../common/errors/engine-not-ready.error';
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
  let directory: string;
  let repo: Repository<ScheduledMessage>;
  let messageService: Partial<MessageService>;
  let bulkMessageService: Partial<BulkMessageService>;
  let service: ScheduledMessageService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'scheduler-test-'));
    ds = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'data.sqlite'),
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
    rmSync(directory, { recursive: true, force: true });
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

    it('clears a previous error when a failed schedule is queued again', async () => {
      const item = await service.create('sess-1', {
        recipient: '628111', messageType: 'text', scheduledAt: new Date(Date.now() - 1000).toISOString(),
        details: { content: 'Retry me' },
      });
      item.status = ScheduledMessageStatus.FAILED;
      item.error = 'Session is not connected';
      await repo.save(item);

      const retried = await service.update('sess-1', item.id, { status: 'pending' });
      expect(retried.status).toBe(ScheduledMessageStatus.PENDING);
      expect(retried.error).toBeNull();
      await service.processDueMessages();
      expect((await service.findOne('sess-1', item.id)).status).toBe(ScheduledMessageStatus.SENT);
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
  it('imports browser schedules idempotently, including after delivery', async () => {
    const dto = {
      clientId: 'sched_123_abc', recipient: '628111', messageType: 'text',
      scheduledAt: new Date(Date.now() - 1000).toISOString(), details: { content: 'Import' },
    };
    const first = await service.create('sess-1', dto);
    await service.dispatchMessage(first);
    const again = await service.create('sess-1', dto);
    expect(again.id).toBe(first.id);
    expect(again.status).toBe(ScheduledMessageStatus.SENT);
    expect(await repo.count()).toBe(1);
  });

  it('does not deliver a stale snapshot again or send a cancelled snapshot', async () => {
    const item = await service.create('sess-1', {
      recipient: '628111', messageType: 'text', scheduledAt: new Date().toISOString(),
      details: { content: 'Once' },
    });
    const stale = { ...item };
    await service.dispatchMessage(item);
    expect((await service.dispatchMessage(stale)).success).toBe(false);
    expect(messageService.sendText).toHaveBeenCalledTimes(1);
    const cancelled = await service.create('sess-1', {
      recipient: '628111', messageType: 'text', scheduledAt: new Date().toISOString(),
      details: { content: 'Cancelled' },
    });
    await service.cancel('sess-1', cancelled.id);
    expect((await service.dispatchMessage(cancelled)).success).toBe(false);
    expect(messageService.sendText).toHaveBeenCalledTimes(1);
  });

  it('keeps disconnected schedules pending and resumes after WhatsApp is ready', async () => {
    const registry = new EngineRegistry();
    service = new ScheduledMessageService(repo, messageService as MessageService, bulkMessageService as BulkMessageService, undefined, registry);
    const item = await service.create('sess-1', {
      recipient: '628111', messageType: 'text', scheduledAt: new Date(Date.now() - 1000).toISOString(),
      details: { content: 'Reconnect' },
    });
    await service.processDueMessages();
    expect((await service.findOne('sess-1', item.id)).status).toBe(ScheduledMessageStatus.PENDING);
    expect(messageService.sendText).not.toHaveBeenCalled();
    registry.set('sess-1', { getStatus: () => EngineStatus.READY } as any);
    await service.processDueMessages();
    expect(messageService.sendText).toHaveBeenCalledTimes(1);
  });

  it('retries a due message when WhatsApp disconnects between the ready check and send', async () => {
    const registry = new EngineRegistry();
    registry.set('sess-1', { getStatus: () => EngineStatus.READY } as any);
    service = new ScheduledMessageService(repo, messageService as MessageService, bulkMessageService as BulkMessageService, undefined, registry);
    const item = await service.create('sess-1', {
      recipient: '628111', messageType: 'text', scheduledAt: new Date(Date.now() - 1000).toISOString(),
      details: { content: 'Retry after reconnect' },
    });
    (messageService.sendText as jest.Mock)
      .mockRejectedValueOnce(new EngineNotReadyError())
      .mockResolvedValueOnce({ messageId: 'wa-msg-1' });

    await service.processDueMessages();
    expect((await service.findOne('sess-1', item.id)).status).toBe(ScheduledMessageStatus.PENDING);

    await service.processDueMessages();
    expect((await service.findOne('sess-1', item.id)).status).toBe(ScheduledMessageStatus.SENT);
    expect(messageService.sendText).toHaveBeenCalledTimes(2);
  });

  it('delivers persisted due work after the database and worker restart without a browser', async () => {
    const item = await service.create('sess-1', {
      recipient: '628111', messageType: 'text', scheduledAt: new Date(Date.now() - 1000).toISOString(),
      details: { content: 'Survives restart' },
    });
    await ds.destroy();
    await ds.initialize();
    repo = ds.getRepository(ScheduledMessage);
    service = new ScheduledMessageService(repo, messageService as MessageService, bulkMessageService as BulkMessageService);
    await service.processDueMessages();
    expect((await service.findOne('sess-1', item.id)).status).toBe(ScheduledMessageStatus.SENT);
    await service.processDueMessages();
    expect(messageService.sendText).toHaveBeenCalledTimes(1);
  });

  it('automatically wakes up a disconnected session when a message is due', async () => {
    const registry = new EngineRegistry();
    const mockSessionService = {
      start: jest.fn().mockResolvedValue(undefined),
    };
    service = new ScheduledMessageService(
      repo,
      messageService as MessageService,
      bulkMessageService as BulkMessageService,
      undefined,
      registry,
      mockSessionService as any,
    );
    const item = await service.create('sess-auto-wake', {
      recipient: '628111',
      messageType: 'text',
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      details: { content: 'Wake up and send' },
    });

    await service.processDueMessages();
    expect(mockSessionService.start).toHaveBeenCalledWith('sess-auto-wake');
    expect((await service.findOne('sess-auto-wake', item.id)).status).toBe(ScheduledMessageStatus.PENDING);
  });

});

