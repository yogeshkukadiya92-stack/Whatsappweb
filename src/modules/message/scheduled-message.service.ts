import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
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
import { DateTransformer } from '../../common/transformers/date.transformer';

@Injectable()
export class ScheduledMessageService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledMessageService.name);
  private timer?: NodeJS.Timeout;
  private readonly executing = new Set<string>();

  constructor(
    @InjectRepository(ScheduledMessage, 'data')
    private readonly repo: Repository<ScheduledMessage>,
    private readonly messageService: MessageService,
    private readonly bulkMessageService: BulkMessageService,
    @Optional()
    private readonly ownership?: SessionOwnershipService,
  ) {}

  onApplicationBootstrap(): void {
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

    const recipientType = dto.recipientType || 'personal';
    const recipient = this.normalizeRecipient(dto.recipient, recipientType);
    const previewText = dto.previewText || this.generatePreviewText(dto);

    const item = this.repo.create({
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

    const saved = await this.repo.save(item);
    return saved;
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

      // Handle recurrence
      await this.handleRecurrence(item);

      return { success: true, messageId: sentMessageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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
    try {
      const now = new Date();
      const nowParam = (DateTransformer.to(now) as string | Date | null) ?? now;

      const due = await this.repo
        .createQueryBuilder('item')
        .where('item.status = :status', { status: ScheduledMessageStatus.PENDING })
        .andWhere('item.scheduled_at <= :now', { now: nowParam })
        .orderBy('item.scheduled_at', 'ASC')
        .take(15)
        .getMany();

      if (due.length === 0) return;

      for (const item of due) {
        if (this.executing.has(item.id)) continue;
        await this.dispatchMessage(item);
      }
    } catch (err) {
      this.logger.error(`Error checking due scheduled messages: ${String(err)}`);
    }
  }
}
