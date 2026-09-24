import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ScheduledMessage,
  ScheduledMessageStatus,
} from './entities/scheduled-message.entity';
import {
  CreateScheduledMessageDto,
  UpdateScheduledMessageDto,
} from './dto/scheduled-message.dto';
import { MessageService } from './message.service';
import { BulkMessageService } from './bulk-message.service';
import { SessionOwnershipService } from '../session/session-ownership.service';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { EngineStatus } from '../../engine/interfaces/whatsapp-engine.interface';
import { EngineNotReadyError } from '../../common/errors/engine-not-ready.error';
import { DateTransformer } from '../../common/transformers/date.transformer';

@Injectable()
export class ScheduledMessageService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledMessageService.name);
  private timer?: NodeJS.Timeout;
  private readonly executing = new Set<string>();
  private processing = false;

  constructor(
    @InjectRepository(ScheduledMessage, 'data')
    private readonly repo: Repository<ScheduledMessage>,
    private readonly messageService: MessageService,
    private readonly bulkMessageService: BulkMessageService,
    @Optional()
    private readonly ownership?: SessionOwnershipService,
    @Optional()
    private readonly engines?: EngineRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log('Database-backed message scheduler started (10 second polling; browser independent)');
    this.timer = setInterval(() => void this.processDueMessages(), 10_000);
    this.timer.unref();
    void this.processDueMessages();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private normalizeRecipient(recipient: string, type: 'personal' | 'group'): string {
    const trimmed = recipient.trim();
    if (type === 'group') {
      if (trimmed.endsWith('@g.us')) return trimmed;
      return `${trimmed.replace(/@.*$/, '')}@g.us`;
    }
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, '');
    return `${digits}@c.us`;
  }

  private generatePreviewText(dto: CreateScheduledMessageDto | UpdateScheduledMessageDto): string {
    const mType = dto.messageType || 'message';
    const d = dto.details || {};
    if (mType === 'poll') {
      const q = d.pollQuestion || '';
      const opts = (d.pollOptions || []).filter(o => o.trim().length > 0);
      return `📊 Poll: ${q} (${opts.join(', ')})`;
    }
    if (mType === 'location') {
      return `📍 Location: ${d.latitude || ''}, ${d.longitude || ''}`;
    }
    if (mType === 'contact') {
      return `👤 Contact: ${d.contactName || ''} (${d.contactNumber || ''})`;
    }
    if (['image', 'video', 'audio', 'document', 'sticker'].includes(mType)) {
      return `📎 ${mType.toUpperCase()}: ${d.content || d.mediaUrl || 'Attached media'}`;
    }
    if (mType === 'bulk') {
      return `📢 Bulk: ${d.content || 'Bulk campaign'}`;
    }
    return d.content?.trim() || `${mType} message`;
  }

  async create(sessionId: string, dto: CreateScheduledMessageDto): Promise<ScheduledMessage> {
    const scheduledDate = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduledAt date format');
    }

    let importId: string | undefined;
    if (dto.clientId) {
      const hash = createHash('sha256').update(`${sessionId}:${dto.clientId}`).digest('hex');
      importId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const existing = await this.repo.findOne({ where: { id: importId, sessionId } });
      if (existing) return existing;
    }
    const recipientType = dto.recipientType || 'personal';
    const recipient = this.normalizeRecipient(dto.recipient, recipientType);
    const previewText = dto.previewText || this.generatePreviewText(dto);

    const item = this.repo.create({
      ...(importId ? { id: importId } : {}),
      sessionId,
      recipient,
      recipientType,
      messageType: dto.messageType,
      scheduledAt: scheduledDate,
      previewText,
      details: dto.details,
      recurrence: dto.recurrence,
      status: ScheduledMessageStatus.PENDING,
    });

    if (importId) {
      try {
        await this.repo.insert(item);
      } catch (error) {
        const existing = await this.repo.findOne({ where: { id: importId, sessionId } });
        if (existing) return existing;
        throw error;
      }
      return this.findOne(sessionId, importId);
    }
    return this.repo.save(item);
  }

  async findAll(options?: { sessionId?: string; status?: string }): Promise<ScheduledMessage[]> {
    const qb = this.repo.createQueryBuilder('item');
    if (options?.sessionId) {
      qb.andWhere('item.sessionId = :sessionId', { sessionId: options.sessionId });
    }
    if (options?.status && options.status !== 'all') {
      qb.andWhere('item.status = :status', { status: options.status });
    }
    qb.orderBy('item.scheduledAt', 'ASC');
    return qb.getMany();
  }

  async findOne(sessionId: string, id: string): Promise<ScheduledMessage> {
    const item = await this.repo.findOne({ where: { id, sessionId } });
    if (!item) {
      throw new NotFoundException(`Scheduled message '${id}' not found`);
    }
    return item;
  }

  async update(sessionId: string, id: string, dto: UpdateScheduledMessageDto): Promise<ScheduledMessage> {
    const item = await this.findOne(sessionId, id);

    if (dto.recipient) {
      const rType = dto.recipientType || item.recipientType;
      item.recipient = this.normalizeRecipient(dto.recipient, rType);
    }
    if (dto.recipientType) item.recipientType = dto.recipientType;
    if (dto.messageType) item.messageType = dto.messageType;
    if (dto.details) item.details = dto.details;
    if (dto.recurrence !== undefined) item.recurrence = dto.recurrence;
    if (dto.previewText) {
      item.previewText = dto.previewText;
    } else if (dto.details || dto.messageType) {
      item.previewText = this.generatePreviewText({ ...item, ...dto } as any);
    }

    if (dto.scheduledAt) {
      const nextDate = new Date(dto.scheduledAt);
      if (Number.isNaN(nextDate.getTime())) {
        throw new BadRequestException('Invalid scheduledAt date format');
      }
      item.scheduledAt = nextDate;
      if (item.status !== ScheduledMessageStatus.SENT) {
        item.status = ScheduledMessageStatus.PENDING;
        item.error = null;
      }
    }

    if (dto.status) {
      item.status = dto.status as ScheduledMessageStatus;
      if (item.status === ScheduledMessageStatus.PENDING) item.error = null;
    }

    return this.repo.save(item);
  }

  async cancel(sessionId: string, id: string): Promise<ScheduledMessage> {
    const item = await this.findOne(sessionId, id);
    item.status = ScheduledMessageStatus.CANCELLED;
    return this.repo.save(item);
  }

  async delete(sessionId: string, id: string): Promise<void> {
    const item = await this.findOne(sessionId, id);
    await this.repo.remove(item);
  }

  async sendNow(sessionId: string, id: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const item = await this.findOne(sessionId, id);
    return this.dispatchMessage(item);
  }

  async dispatchMessage(item: ScheduledMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.executing.has(item.id)) {
      return { success: false, error: 'Already executing' };
    }
    this.executing.add(item.id);

    try {
      // Re-read after acquiring the in-process lock: a timer or manual request may hold an
      // old snapshot of a row that another dispatch has already completed or cancelled.
      item = await this.findOne(item.sessionId, item.id);
      if (item.status !== ScheduledMessageStatus.PENDING) {
        return { success: false, error: `Message is ${item.status}; it is not pending` };
      }
      if (this.ownership && !this.ownership.owns(item.sessionId)) {
        return { success: false, error: 'Waiting for the session owner' };
      }
      if (this.engines && this.engines.get(item.sessionId)?.getStatus() !== EngineStatus.READY) {
        return { success: false, error: 'Waiting for WhatsApp to reconnect; message remains scheduled' };
      }
      const { sessionId, recipient, messageType, details } = item;
      let sentMessageId: string | undefined;

      switch (messageType) {
        case 'text':
          if (!details.content?.trim()) throw new Error('Message text content is empty');
          const textRes = await this.messageService.sendText(sessionId, {
            chatId: recipient,
            text: details.content.trim(),
          });
          sentMessageId = textRes.messageId;
          break;

        case 'poll': {
          const name = details.pollQuestion?.trim();
          const options = (details.pollOptions || []).map(o => o.trim()).filter(o => o.length > 0);
          if (!name) throw new Error('Poll question is required');
          if (options.length < 2) throw new Error(`Poll requires at least 2 options (found ${options.length})`);
          const pollRes = await this.messageService.sendPoll(sessionId, {
            chatId: recipient,
            name,
            options,
            allowMultipleAnswers: !!details.allowMultipleAnswers,
          });
          sentMessageId = pollRes.messageId;
          break;
        }

        case 'image':
        case 'video':
        case 'audio':
        case 'document': {
          const mediaDto: any = {
            chatId: recipient,
            media: details.mediaFile
              ? { base64: details.mediaFile.base64, mimetype: details.mediaFile.mimetype, filename: details.mediaFile.filename }
              : details.mediaUrl
                ? { url: details.mediaUrl }
                : undefined,
            caption: details.content?.trim() || undefined,
          };
          if (messageType === 'document' && details.content?.trim()) {
            mediaDto.filename = details.content.trim();
          }

          let res: any;
          if (messageType === 'image') res = await this.messageService.sendImage(sessionId, mediaDto);
          else if (messageType === 'video') res = await this.messageService.sendVideo(sessionId, mediaDto);
          else if (messageType === 'audio') res = await this.messageService.sendAudio(sessionId, mediaDto);
          else res = await this.messageService.sendDocument(sessionId, mediaDto);
          sentMessageId = res?.messageId;
          break;
        }

        case 'sticker': {
          const stickerDto: any = {
            chatId: recipient,
            media: details.mediaFile
              ? { base64: details.mediaFile.base64, mimetype: details.mediaFile.mimetype }
              : details.mediaUrl
                ? { url: details.mediaUrl }
                : undefined,
          };
          const stickerRes = await this.messageService.sendSticker(sessionId, stickerDto);
          sentMessageId = stickerRes.messageId;
          break;
        }

        case 'location': {
          const lat = parseFloat(details.latitude || '');
          const lng = parseFloat(details.longitude || '');
          if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('Invalid coordinates');
          const locRes = await this.messageService.sendLocation(sessionId, {
            chatId: recipient,
            latitude: lat,
            longitude: lng,
            description: details.locationDescription?.trim() || undefined,
            address: details.locationAddress?.trim() || undefined,
          });
          sentMessageId = locRes.messageId;
          break;
        }

        case 'contact': {
          if (!details.contactName || !details.contactNumber) throw new Error('Contact name and number are required');
          const contRes = await this.messageService.sendContact(sessionId, {
            chatId: recipient,
            contactName: details.contactName.trim(),
            contactNumber: details.contactNumber.trim(),
          });
          sentMessageId = contRes.messageId;
          break;
        }

        case 'forward': {
          if (!details.forwardMessageId) throw new Error('forwardMessageId is required');
          const fwdRes = await this.messageService.forward(sessionId, {
            fromChatId: details.forwardFrom || recipient,
            toChatId: details.forwardTo || recipient,
            messageId: details.forwardMessageId,
          });
          sentMessageId = fwdRes.messageId;
          break;
        }

        case 'bulk': {
          const recipients = (details.bulkRecipients || '')
            .split(/[\n,]+/)
            .map(s => s.trim().replace(/[^0-9]/g, ''))
            .filter(s => s.length >= 7)
            .map(s => `${s}@c.us`);
          if (!recipients.length) throw new Error('No valid recipients in bulk list');
          const bulkBatch = await this.bulkMessageService.createBatch(sessionId, {
            confirmedOptIn: true,
            messages: recipients.map(cId => ({
              chatId: cId,
              type: 'text' as const,
              content: { text: details.content || '' },
            })),
            options: details.bulkDelay ? { delayBetweenMessages: Number(details.bulkDelay) } : undefined,
          });
          sentMessageId = bulkBatch.batchId;
          break;
        }

        default:
          throw new Error(`Unsupported scheduled message type: ${messageType}`);
      }

      item.status = ScheduledMessageStatus.SENT;
      item.sentAt = new Date();
      item.error = null;
      await this.repo.save(item);
      this.logger.log(`Delivered scheduled message ${item.id}`);

      // Handle recurrence
      try {
        await this.handleRecurrence(item);
      } catch (error) {
        // Delivery already succeeded. Never turn it into a retryable failed send.
        this.logger.error(`Could not schedule recurrence for ${item.id}: ${String(error)}`);
      }

      return { success: true, messageId: sentMessageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // The engine can disconnect after the READY check but before the actual send. That
      // rejection means WhatsApp never accepted the message, so keep the schedule due for
      // the next poll after reconnection instead of making a transient outage terminal.
      if (err instanceof EngineNotReadyError) {
        this.logger.warn(`Scheduled message ${item.id} is waiting for WhatsApp to reconnect`);
        return { success: false, error: errorMsg };
      }
      this.logger.error(`Failed to dispatch scheduled message ${item.id}: ${errorMsg}`);
      item.status = ScheduledMessageStatus.FAILED;
      item.error = errorMsg;
      await this.repo.save(item);
      return { success: false, error: errorMsg };
    } finally {
      this.executing.delete(item.id);
    }
  }

  private async handleRecurrence(item: ScheduledMessage): Promise<void> {
    const rule = item.recurrence;
    if (!rule || rule.frequency === 'none') return;

    const next = new Date(item.scheduledAt);
    if (rule.frequency === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (rule.frequency === 'weekly') {
      let guard = 0;
      do {
        next.setDate(next.getDate() + 1);
        guard++;
      } while (rule.days?.length && !rule.days.includes(next.getDay()) && guard < 8);
    }

    const [hours, minutes] = (rule.time || '09:00').split(':').map(Number);
    next.setHours(hours || 0, minutes || 0, 0, 0);

    if (rule.endDate && next > new Date(`${rule.endDate}T23:59:59`)) {
      return;
    }

    const nextItem = this.repo.create({
      sessionId: item.sessionId,
      recipient: item.recipient,
      recipientType: item.recipientType,
      messageType: item.messageType,
      scheduledAt: next,
      previewText: item.previewText,
      details: item.details,
      recurrence: item.recurrence,
      status: ScheduledMessageStatus.PENDING,
    });

    await this.repo.save(nextItem);
    this.logger.log(`Scheduled next recurring message for ${next.toISOString()}`);
  }

  async processDueMessages(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      const nowParam = (DateTransformer.to(now) as string | Date | null) ?? now;

      const query = this.repo
        .createQueryBuilder('item')
        .where('item.status = :status', { status: ScheduledMessageStatus.PENDING })
        .andWhere('item.scheduled_at <= :now', { now: nowParam })
        .orderBy('item.scheduled_at', 'ASC')
        .take(15);
      if (this.engines) {
        const ready = this.engines.entries()
          .filter(([id, engine]) => engine.getStatus() === EngineStatus.READY && (!this.ownership || this.ownership.owns(id)))
          .map(([id]) => id);
        if (!ready.length) return;
        query.andWhere('item.session_id IN (:...ready)', { ready });
      }
      const due = await query.getMany();

      if (due.length === 0) return;

      for (const item of due) {
        if (this.executing.has(item.id)) continue;
        await this.dispatchMessage(item);
      }
    } catch (err) {
      this.logger.error(`Error checking due scheduled messages: ${String(err)}`);
    } finally {
      this.processing = false;
    }
  }
}
