import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { StudioConnection } from './entities/studio-connection.entity';
import { openStudioSecret, sealStudioSecret, studioVaultReady } from './studio-vault';
import { withSafeFetch } from '../../common/security/ssrf-guard';
import { readStudioResponse } from './studio-content';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class SaveStudioConnectionDto {
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsIn(['api', 'mcp']) kind?: 'api' | 'mcp';
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allowedTools?: string[];
  @IsString() @MaxLength(2000) baseUrl!: string;
  @IsIn(['none', 'bearer', 'apiKey', 'basic']) auth!: StudioConnection['auth'];
  @IsOptional() @IsString() @MaxLength(100) headerName?: string;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @MaxLength(4000) secret?: string;
}
export function studioConnectionUrl(base: string, path: string): string {
  const root = new URL(base);
  if (
    root.protocol !== 'https:' ||
    root.username ||
    root.password ||
    (root.port && root.port !== '443') ||
    root.search ||
    root.hash
  )
    throw new Error('Connection requires a public HTTPS base URL without credentials, query or fragment.');
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  if (!path || path.length > 4000 || /^[a-z]+:/i.test(path) || path.startsWith('/') || /[\\#]/.test(path))
    throw new Error('Use a relative API path inside the connection base.');
  const decoded = decodeURIComponent(path.split('?')[0]);
  if (decoded.split('/').some(part => part === '..' || part === '.') || /[\\%]/.test(decoded))
    throw new Error('API path traversal is not allowed.');
  const url = new URL(path, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    throw new Error('API path escapes connection scope.');
  return url.href;
}
@Injectable()
export class StudioConnectionService {
  constructor(@InjectRepository(StudioConnection, 'data') private readonly connections: Repository<StudioConnection>) {}
  async list(sessionId: string) {
    return {
      vaultReady: studioVaultReady(),
      connections: await this.connections.find({ where: { sessionId }, order: { name: 'ASC' } }),
    };
  }
  async save(sessionId: string, dto: SaveStudioConnectionDto, id?: string) {
    try {
      studioConnectionUrl(dto.baseUrl, 'probe');
      if (!dto.name.trim()) throw new Error('Connection name is required.');
      if (dto.auth === 'apiKey' && !/^x-[a-z0-9-]+$/i.test(dto.headerName || ''))
        throw new Error('API key header must start with X-.');
      const old = id
        ? await this.connections
            .createQueryBuilder('c')
            .addSelect('c.secret')
            .where('c.id = :id AND c.sessionId = :sessionId', { id, sessionId })
            .getOne()
        : null;
      if (id && !old) throw new NotFoundException('Connection not found.');
      if (!old && (await this.connections.countBy({ sessionId })) >= 32)
        throw new Error('Maximum 32 connections per session.');
      const connectionId = old?.id || randomUUID();
      let secret = old?.secret || null;
      if (dto.auth === 'none') secret = null;
      else if (dto.secret) {
        if (/[\r\n]/.test(dto.secret)) throw new Error('Credential cannot contain line breaks.');
        if (dto.auth === 'basic' && !dto.secret.includes(':'))
          throw new Error('Basic credential must be username:password.');
        secret = sealStudioSecret(dto.secret, `${sessionId}:${connectionId}`);
      } else if (
        !secret ||
        old?.baseUrl !== dto.baseUrl ||
        old?.auth !== dto.auth ||
        old?.headerName !== (dto.headerName || '')
      ) {
        throw new Error('Enter a fresh credential when changing connection scope or authentication.');
      }
      if (old && old.kind !== (dto.kind || 'api') && dto.auth !== 'none' && !dto.secret)
        throw new Error('Changing connection kind requires a fresh credential.');
      await this.connections.save({
        id: connectionId,
        sessionId,
        name: dto.name.trim(),
        kind: dto.kind || 'api',
        allowedTools: [...new Set((dto.allowedTools || []).map(name => name.trim()).filter(Boolean))],
        baseUrl: dto.baseUrl,
        auth: dto.auth,
        headerName: dto.headerName || '',
        enabled: dto.enabled,
        secret,
      });
      return this.connections.findOneByOrFail({ id: connectionId, sessionId });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Connection could not be saved.');
    }
  }
  async remove(sessionId: string, id: string) {
    if (!(await this.connections.delete({ sessionId, id })).affected)
      throw new NotFoundException('Connection not found.');
  }
  async request(sessionId: string, id: string, path: string): Promise<unknown> {
    const connection = await this.connections
      .createQueryBuilder('c')
      .addSelect('c.secret')
      .where('c.id = :id AND c.sessionId = :sessionId', { id, sessionId })
      .getOne();
    if (!connection?.enabled || connection.kind !== 'api')
      throw new Error('API connection is unavailable or disabled.');
    const url = studioConnectionUrl(connection.baseUrl, path);
    const credential = connection.secret ? openStudioSecret(connection.secret, `${sessionId}:${id}`) : '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (connection.auth === 'bearer') headers.Authorization = `Bearer ${credential}`;
    if (connection.auth === 'apiKey') headers[connection.headerName] = credential;
    if (connection.auth === 'basic') headers.Authorization = `Basic ${Buffer.from(credential).toString('base64')}`;
    try {
      return await withSafeFetch(
        url,
        { method: 'GET', headers, signal: AbortSignal.timeout(10000) },
        async response => {
          if (!response.ok) throw new Error();
          const text = await readStudioResponse(response);
          if (credential && (text.includes(credential) || text.includes(Buffer.from(credential).toString('base64'))))
            throw new Error();
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return text;
          }
        },
      );
    } catch {
      throw new Error('Connected API request failed. Check credentials, permissions and endpoint.');
    }
  }
  async mcp(sessionId: string, id: string, tool?: string, args?: Record<string, unknown>): Promise<unknown> {
    const connection = await this.connections
      .createQueryBuilder('c')
      .addSelect('c.secret')
      .where('c.id = :id AND c.sessionId = :sessionId', { id, sessionId })
      .getOne();
    if (!connection?.enabled || connection.kind !== 'mcp')
      throw new Error('MCP connection is unavailable or disabled.');
    if (tool && !connection.allowedTools.includes(tool))
      throw new Error('MCP tool is not approved for this connection.');
    const credential = connection.secret ? openStudioSecret(connection.secret, `${sessionId}:${id}`) : '';
    const client = new Client({ name: 'waply-studio', version: '1.0.0' }, { capabilities: {} });
    const deadline = AbortSignal.timeout(20000);
    const transport = new StreamableHTTPClientTransport(new URL(connection.baseUrl), {
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
      fetch: async (url, init) => {
        if (new URL(url).href !== new URL(connection.baseUrl).href) throw new Error('MCP endpoint scope violation.');
        if (init?.method === 'GET') return new Response(null, { status: 405 });
        if (init?.method !== 'POST' && init?.method !== 'DELETE') throw new Error('Unsupported MCP transport method.');
        const headers = new Headers(init.headers);
        if (connection.auth === 'bearer') headers.set('Authorization', `Bearer ${credential}`);
        if (connection.auth === 'apiKey') headers.set(connection.headerName, credential);
        if (connection.auth === 'basic')
          headers.set('Authorization', `Basic ${Buffer.from(credential).toString('base64')}`);
        return withSafeFetch(
          connection.baseUrl,
          {
            method: init.method,
            headers: Object.fromEntries(headers.entries()),
            body: typeof init.body === 'string' ? init.body : undefined,
            signal: deadline,
          },
          async response => {
            const text = await readStudioResponse(response);
            if (credential && (text.includes(credential) || text.includes(Buffer.from(credential).toString('base64'))))
              throw new Error('Credential echoed by MCP server.');
            const contentType = response.headers.get('content-type') || '';
            if (init.method !== 'DELETE' && response.status !== 202 && !contentType.includes('application/json'))
              throw new Error('MCP server must support JSON Streamable HTTP responses.');
            const resultHeaders: Record<string, string> = { 'Content-Type': contentType };
            const session = response.headers.get('mcp-session-id');
            if (session) resultHeaders['mcp-session-id'] = session;
            return new Response(text || null, { status: response.status, headers: resultHeaders });
          },
        );
      },
    });
    try {
      await client.connect(transport, { timeout: 20000, signal: deadline });
      const result = await client.listTools({}, { timeout: 20000, signal: deadline });
      if (result.nextCursor || result.tools.length > 100)
        throw new Error('MCP catalog exceeds supported single-page limit.');
      const tools = result.tools.filter(
        item => item.annotations?.readOnlyHint === true && item.annotations?.destructiveHint !== true,
      );
      if (!tool)
        return tools.map(item => ({
          name: item.name,
          description: (item.description || '').slice(0, 2000),
          inputSchema: item.inputSchema,
        }));
      if (!tools.some(item => item.name === tool))
        throw new Error('MCP tool must advertise read-only, non-destructive access.');
      const response = await client.callTool({ name: tool, arguments: args || {} }, undefined, {
        timeout: 20000,
        signal: deadline,
      });
      if (response.isError) throw new Error('MCP tool failed.');
      const content: unknown = response.content;
      if (
        !Array.isArray(content) ||
        (content as unknown[]).some(
          item =>
            !item ||
            typeof item !== 'object' ||
            (item as Record<string, unknown>).type !== 'text' ||
            typeof (item as Record<string, unknown>).text !== 'string',
        )
      )
        throw new Error('Only MCP text results are supported.');
      return {
        text: (content as { type: 'text'; text: string }[]).map(item => item.text).join('\n'),
        ...(response.structuredContent ? { data: response.structuredContent } : {}),
      };
    } catch {
      throw new Error('MCP request failed. Check endpoint, read-only tool permissions and JSON transport support.');
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }
}
