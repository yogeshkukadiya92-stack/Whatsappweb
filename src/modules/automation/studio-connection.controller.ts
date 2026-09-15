import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentApiKey, RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { CompleteStudioOAuthDto } from './dto/studio-oauth.dto';
import { oauthHash } from './studio-oauth';
import { SaveStudioConnectionDto, StudioConnectionService } from './studio-connection.service';

@RequireRole(ApiKeyRole.OPERATOR)
@Controller('sessions/:sessionId/studio-connections')
export class StudioConnectionController {
  constructor(private readonly connections: StudioConnectionService) {}
  @RequireRole(ApiKeyRole.ADMIN) @Post(':id/oauth/start') startOAuth(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @CurrentApiKey() key: ApiKey,
  ) {
    return this.connections.startOAuth(sessionId, id, key ? oauthHash(`${key.id}:${key.keyHash}`) : '');
  }
  @RequireRole(ApiKeyRole.ADMIN) @Post(':id/oauth/complete') completeOAuth(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @CurrentApiKey() key: ApiKey,
    @Body() dto: CompleteStudioOAuthDto,
  ) {
    return this.connections.completeOAuth(sessionId, id, key ? oauthHash(`${key.id}:${key.keyHash}`) : '', dto);
  }
  @RequireRole(ApiKeyRole.ADMIN) @Post(':id/oauth/disconnect') disconnectOAuth(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    return this.connections.disconnectOAuth(sessionId, id);
  }
  @Get() list(@Param('sessionId') sessionId: string) {
    return this.connections.list(sessionId);
  }
  @RequireRole(ApiKeyRole.ADMIN) @Post(':id/tools') tools(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    return this.connections.mcp(sessionId, id);
  }
  @RequireRole(ApiKeyRole.ADMIN) @Post() create(
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveStudioConnectionDto,
  ) {
    return this.connections.save(sessionId, dto);
  }
  @RequireRole(ApiKeyRole.ADMIN) @Put(':id') update(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: SaveStudioConnectionDto,
  ) {
    return this.connections.save(sessionId, dto, id);
  }
  @RequireRole(ApiKeyRole.ADMIN) @Delete(':id') @HttpCode(204) async remove(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    await this.connections.remove(sessionId, id);
  }
}
