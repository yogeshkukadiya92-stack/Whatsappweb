import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { CloudMenuConnection, CloudMenuReceipt } from './entities/cloud-menu.entity';
import { LeadFlow } from './entities/lead-flow.entity';
import { parseSteps, parseTriggers } from './lead-flow.service';
import { SaveCloudMenuDto } from './dto/cloud-menu.dto';
import { openStudioSecret, sealStudioSecret, studioVaultReady } from './studio-vault';
import { createLogger } from '../../common/services/logger.service';

type Credentials = { accessToken: string; appSecret: string };
interface CloudMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string } };
  context?: { id?: string };
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function equal(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

@Injectable()
export class CloudMenuService {
  private readonly logger = createLogger('CloudMenuService');
  constructor(
    @InjectRepository(CloudMenuConnection, 'data') private readonly connections: Repository<CloudMenuConnection>,
    @InjectRepository(CloudMenuReceipt, 'data') private readonly receipts: Repository<CloudMenuReceipt>,
    @InjectRepository(LeadFlow, 'data') private readonly flows: Repository<LeadFlow>,
  ) {}
  private revision(flow: LeadFlow) {
    return hash(
      JSON.stringify({ name: flow.name, triggers: parseTriggers(flow.triggers), steps: parseSteps(flow.steps) }),
    );
  }
  private scope(c: CloudMenuConnection) {
    return `cloud-menu:${c.sessionId}:${c.id}`;
  }
  private metadata(c: CloudMenuConnection | null) {
    return {
      configured: !!c,
      vaultReady: studioVaultReady(),
      enabled: c?.enabled || false,
      phoneNumberId: c?.phoneNumberId || '',
      apiVersion: c?.apiVersion || 'v23.0',
      webhookPath: c ? `/api/whatsapp-cloud-menus/${c.id}` : null,
    };
  }
  async settings(sessionId: string) {
    return this.metadata(await this.connections.findOneBy({ sessionId }));
  }
  private async connection(where: { sessionId: string } | { id: string }) {
    const c = await this.connections.findOne({
      where,
      select: {
        id: true,
        sessionId: true,
        phoneNumberId: true,
        apiVersion: true,
        enabled: true,
        secret: true,
        verifyTokenHash: true,
      },
    });
    if (!c) throw new NotFoundException('WhatsApp Business API connection not found.');
    return c;
  }
  async save(sessionId: string, dto: SaveCloudMenuDto) {
    if (!studioVaultReady())
      throw new BadRequestException(
        'Ask your administrator to configure STUDIO_VAULT_KEY before saving Business API credentials.',
      );
    if (!/^\d{5,30}$/.test(dto.phoneNumberId) || !/^v\d{1,2}\.\d{1,2}$/.test(dto.apiVersion))
      throw new BadRequestException('Invalid Phone Number ID or Graph API version.');
    const existing = await this.connections.findOneBy({ sessionId });
    const c = existing
      ? await this.connection({ sessionId })
      : this.connections.create({ id: randomUUID(), sessionId });
    const previous: Partial<Credentials> =
      existing && (!dto.accessToken?.trim() || !dto.appSecret?.trim())
        ? (JSON.parse(openStudioSecret(c.secret, this.scope(c))) as Credentials)
        : {};
    if (existing && c.phoneNumberId !== dto.phoneNumberId && (!dto.accessToken || !dto.appSecret))
      throw new BadRequestException('Enter fresh credentials when changing the Phone Number ID.');
    const credentials = {
      accessToken: dto.accessToken?.trim() || previous.accessToken,
      appSecret: dto.appSecret?.trim() || previous.appSecret,
    };
    if (
      !credentials.accessToken ||
      !credentials.appSecret ||
      /[\r\n]/.test(credentials.accessToken + credentials.appSecret)
    )
      throw new BadRequestException('Access token and Meta App Secret are required.');
    const verifyToken = existing ? undefined : randomBytes(24).toString('hex');
    if (verifyToken) c.verifyTokenHash = hash(verifyToken);
    Object.assign(c, {
      phoneNumberId: dto.phoneNumberId,
      apiVersion: dto.apiVersion,
      enabled: dto.enabled,
      secret: sealStudioSecret(JSON.stringify(credentials), this.scope(c)),
    });
    try {
      await this.connections.save(c);
    } catch {
      throw new BadRequestException('This phone is already connected or the session is unavailable.');
    }
    return { ...this.metadata(c), verifyToken };
  }
  async rotateToken(sessionId: string) {
    const c = await this.connection({ sessionId });
    const verifyToken = randomBytes(24).toString('hex');
    await this.connections.update({ id: c.id }, { verifyTokenHash: hash(verifyToken) });
    return { verifyToken };
  }
  async verify(id: string, mode: string, token: string, challenge: string) {
    const c = await this.connection({ id });
    if (
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      !equal(hash(token), c.verifyTokenHash) ||
      !/^\d{1,100}$/.test(challenge || '')
    )
      throw new ForbiddenException('Webhook verification failed.');
    return challenge;
  }
  async receive(id: string, signature: string, raw?: Buffer) {
    const c = await this.connection({ id });
    if (!raw || raw.length > 256 * 1024 || !/^sha256=[a-f0-9]{64}$/i.test(signature || ''))
      throw new ForbiddenException('Webhook signature required.');
    const credentials: Credentials = JSON.parse(openStudioSecret(c.secret, this.scope(c))) as Credentials;
    const expected = `sha256=${createHmac('sha256', credentials.appSecret).update(raw).digest('hex')}`;
    if (!equal(expected, signature.toLowerCase())) throw new ForbiddenException('Webhook signature invalid.');
    if (!c.enabled) return;
    let payload: {
      object?: string;
      entry?: Array<{
        changes?: Array<{ value?: { metadata?: { phone_number_id?: string }; messages?: CloudMessage[] } }>;
      }>;
    };
    try {
      payload = JSON.parse(raw.toString('utf8')) as typeof payload;
    } catch {
      throw new BadRequestException('Invalid webhook JSON.');
    }
    if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return;
    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        const value = change.value;
        if (value?.metadata?.phone_number_id !== c.phoneNumberId || !Array.isArray(value.messages)) continue;
        for (const message of value.messages) await this.message(c, credentials, message);
      }
    }
  }
  private async send(
    c: CloudMenuConnection,
    credentials: Credentials,
    to: string,
    content: Record<string, unknown>,
  ): Promise<string> {
    try {
      const response = await fetch(`https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...content }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const result = (await response.json()) as { messages?: Array<{ id?: string }> };
      if (!result.messages?.[0]?.id) throw new Error();
      return result.messages[0].id;
    } catch {
      throw new BadGatewayException(
        'WhatsApp Business API could not send the resource menu or attachment. Check credentials and file URL.',
      );
    }
  }
  private async claim(c: CloudMenuConnection, messageId: string, sender: string) {
    let row = await this.receipts.findOneBy({ connectionId: c.id, messageId });
    if (!row) {
      row = this.receipts.create({
        id: randomUUID(),
        connectionId: c.id,
        messageId,
        sender,
        status: 'processing',
        leaseUntil: String(Date.now() + 120000),
        responseId: null,
        consumedBy: null,
        menu: null,
      });
      try {
        await this.receipts.insert({
          id: row.id,
          connectionId: c.id,
          messageId,
          sender,
          status: row.status,
          leaseUntil: row.leaseUntil,
          responseId: null,
          consumedBy: null,
          menu: null,
        });
        return row;
      } catch {
        row = await this.receipts.findOneBy({ connectionId: c.id, messageId });
        if (!row) throw new ServiceUnavailableException('Could not record inbound message.');
      }
    }
    if (row.status === 'done') return null;
    if (row.status === 'processing' && Number(row.leaseUntil) > Date.now())
      throw new ServiceUnavailableException('Message is already being processed. Retry later.');
    const claim = await this.receipts.update(
      { id: row.id, status: row.status, leaseUntil: row.leaseUntil },
      { status: 'processing', leaseUntil: String(Date.now() + 120000) },
    );
    if (!claim.affected) throw new ServiceUnavailableException('Message is being processed. Retry later.');
    return row;
  }
  private async message(c: CloudMenuConnection, credentials: Credentials, message: CloudMessage) {
    if (
      !message ||
      typeof message.id !== 'string' ||
      !message.id ||
      message.id.length > 512 ||
      typeof message.from !== 'string' ||
      !/^\d{5,20}$/.test(message.from)
    )
      return;
    const existing = await this.receipts.findOneBy({ connectionId: c.id, messageId: message.id });
    if (existing?.status === 'done') return;
    const time = Number(message.timestamp);
    if (!existing && (!Number.isFinite(time) || time < Date.now() / 1000 - 300 || time > Date.now() / 1000 + 60))
      return;
    const button =
      message.type === 'interactive' && message.interactive?.type === 'button_reply'
        ? message.interactive.button_reply?.id
        : undefined;
    let flow: LeadFlow | undefined;
    if (!button && message.type === 'text' && typeof message.text?.body === 'string') {
      const text = message.text.body.trim().toLowerCase();
      if (!text) return;
      flow = (
        await this.flows.find({ where: { sessionId: c.sessionId, enabled: true }, order: { createdAt: 'ASC' } })
      ).find(candidate => {
        const step = parseSteps(candidate.steps)[0];
        return (
          step?.nativeButtons && parseTriggers(candidate.triggers).some(trigger => text.includes(trigger.toLowerCase()))
        );
      });
    }
    if (!flow && !button) return;
    const receipt = await this.claim(c, message.id, message.from);
    if (!receipt) return;
    try {
      if (button) {
        const match = /^([0-9a-f-]{36}):([0-2])$/i.exec(button);
        const menu = match
          ? await this.receipts.findOneBy({ id: match[1], connectionId: c.id, sender: message.from, status: 'done' })
          : null;
        const original = menu?.menu;
        const current = original
          ? await this.flows.findOneBy({ id: original.flowId, sessionId: c.sessionId, enabled: true })
          : null;
        if (
          menu &&
          original &&
          current &&
          parseSteps(current.steps)[0]?.nativeButtons &&
          this.revision(current) === original.revision &&
          message.context?.id === menu.responseId
        ) {
          const choice = original.choices[Number(match![2])];
          if (choice && (!menu.consumedBy || menu.consumedBy === receipt.id)) {
            if (!menu.consumedBy) {
              const claimed = await this.receipts.update(
                { id: menu.id, consumedBy: IsNull() },
                { consumedBy: receipt.id },
              );
              if (!claimed.affected) throw new ServiceUnavailableException('Another selection is being delivered.');
            }
            const content =
              choice.type === 'link'
                ? { type: 'text', text: { body: [choice.caption, choice.url].filter(Boolean).join('\n') } }
                : {
                    type: choice.type,
                    [choice.type]: {
                      link: choice.url,
                      ...(choice.caption ? { caption: choice.caption } : {}),
                      ...(choice.type === 'document' && choice.filename ? { filename: choice.filename } : {}),
                    },
                  };
            receipt.responseId = await this.send(c, credentials, message.from, content);
          }
        }
      } else if (flow) {
        const step = parseSteps(flow.steps)[0];
        const choices = step.options?.map(option => step.deliveries?.find(delivery => delivery.option === option));
        if (!choices || choices.length < 2 || choices.length > 3 || choices.some(choice => !choice))
          throw new BadRequestException('Native menus need 2–3 resource choices.');
        receipt.menu = {
          flowId: flow.id,
          revision: this.revision(flow),
          question: step.question,
          choices: choices as NonNullable<CloudMenuReceipt['menu']>['choices'],
        };
        await this.receipts.update({ id: receipt.id }, { menu: receipt.menu });
        receipt.responseId = await this.send(c, credentials, message.from, {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: step.question },
            action: {
              buttons: choices.map((choice, index) => ({
                type: 'reply',
                reply: { id: `${receipt.id}:${index}`, title: choice!.option },
              })),
            },
          },
        });
      }
      await this.receipts.update({ id: receipt.id }, { status: 'done', responseId: receipt.responseId });
      if (receipt.responseId)
        this.logger.log('Business API resource menu delivered', {
          connectionId: c.id,
          receiptId: receipt.id,
          kind: receipt.menu ? 'menu' : 'resource',
        });
    } catch (error) {
      await this.receipts.update({ id: receipt.id }, { status: 'failed' });
      this.logger.warn('Business API resource delivery failed', { connectionId: c.id, receiptId: receipt.id });
      throw error;
    }
  }
}
