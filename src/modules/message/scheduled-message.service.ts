import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  ScheduledMessage,
  ScheduledMessageStatus,
  ScheduledMessageType,
} from './entities/scheduled-message.entity';
import { MessageSendService } from './message-send.service';
import { ScheduleMessageDto, ScheduledMessageResponseDto } from './dto/scheduled-message.dto';

@Injectable()
export class ScheduledMessageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledMessageService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @InjectRepository(ScheduledMessage, 'data')
    private readonly scheduledMessages: Repository<ScheduledMessage>,
    private readonly sender: MessageSendService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), 5_000);
    void this.dispatchDue();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async schedule(sessionId: string, dto: ScheduleMessageDto): Promise<ScheduledMessageResponseDto> {
    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('scheduledAt must be a valid date');
    if (scheduledAt.getTime() <= Date.now()) throw new BadRequestException('scheduledAt must be in the future');
    this.assertPayload(dto.type, dto.payload);

    const item = await this.scheduledMessages.save(
      this.scheduledMessages.create({
        sessionId,
        chatId: dto.chatId,
        type: dto.type,
        payload: dto.payload,
        scheduledAt,
        status: ScheduledMessageStatus.PENDING,
      }),
    );
    return this.toDto(item);
  }

  async list(sessionId: string): Promise<ScheduledMessageResponseDto[]> {
    const rows = await this.scheduledMessages.find({
      where: { sessionId },
      order: { scheduledAt: 'DESC', createdAt: 'DESC' },
      take: 100,
    });
    return rows.map(row => this.toDto(row));
  }

  async cancel(sessionId: string, id: string): Promise<ScheduledMessageResponseDto> {
    const item = await this.scheduledMessages.findOneBy({ id, sessionId });
    if (!item) throw new BadRequestException('Scheduled message not found');
    if (item.status !== ScheduledMessageStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel a ${item.status} scheduled message`);
    }
    item.status = ScheduledMessageStatus.CANCELLED;
    return this.toDto(await this.scheduledMessages.save(item));
  }

  private async dispatchDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.scheduledMessages.find({
        where: { status: ScheduledMessageStatus.PENDING, scheduledAt: LessThanOrEqual(new Date()) },
        order: { scheduledAt: 'ASC', createdAt: 'ASC' },
        take: 20,
      });

      for (const item of due) {
        await this.dispatchOne(item);
      }
    } finally {
      this.running = false;
    }
  }

  private async dispatchOne(item: ScheduledMessage): Promise<void> {
    item.status = ScheduledMessageStatus.PROCESSING;
    item.error = undefined;
    await this.scheduledMessages.save(item);

    try {
      const result = await this.send(item);
      item.status = ScheduledMessageStatus.SENT;
      item.sentMessageId = result.messageId;
      item.sentAt = new Date();
    } catch (error) {
      item.status = ScheduledMessageStatus.FAILED;
      item.error = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Scheduled message ${item.id} failed: ${item.error}`);
    }
    await this.scheduledMessages.save(item);
  }

  private send(item: ScheduledMessage) {
    const payload = { ...item.payload, chatId: item.chatId };
    switch (item.type) {
      case 'text':
        return this.sender.sendText(item.sessionId, payload as never);
      case 'image':
        return this.sender.sendImage(item.sessionId, payload as never);
      case 'video':
        return this.sender.sendVideo(item.sessionId, payload as never);
      case 'audio':
        return this.sender.sendAudio(item.sessionId, payload as never);
      case 'document':
        return this.sender.sendDocument(item.sessionId, payload as never);
      case 'location':
        return this.sender.sendLocation(item.sessionId, payload as never);
      case 'contact':
        return this.sender.sendContact(item.sessionId, payload as never);
      case 'sticker':
        return this.sender.sendSticker(item.sessionId, payload as never);
      case 'poll':
        return this.sender.sendPoll(item.sessionId, payload as never);
    }
  }

  private assertPayload(type: ScheduledMessageType, payload: Record<string, unknown>): void {
    if (type === 'text' && typeof payload.text !== 'string') throw new BadRequestException('payload.text is required');
    if (type === 'poll') {
      if (typeof payload.name !== 'string') throw new BadRequestException('payload.name is required');
      if (!Array.isArray(payload.options) || payload.options.length < 2) {
        throw new BadRequestException('payload.options must contain at least two options');
      }
    }
    if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
      if (typeof payload.url !== 'string') {
        throw new BadRequestException('Scheduled media messages currently require payload.url');
      }
    }
  }

  private toDto(item: ScheduledMessage): ScheduledMessageResponseDto {
    return {
      id: item.id,
      sessionId: item.sessionId,
      chatId: item.chatId,
      type: item.type,
      scheduledAt: item.scheduledAt.toISOString(),
      status: item.status,
      sentMessageId: item.sentMessageId,
      error: item.error,
      sentAt: item.sentAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
