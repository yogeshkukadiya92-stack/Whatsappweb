import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, Header } from '@nestjs/common';
import type { Request } from 'express';
import { Public, RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { CloudMenuService } from './cloud-menu.service';
import { SaveCloudMenuDto } from './dto/cloud-menu.dto';

@RequireRole(ApiKeyRole.ADMIN)
@Controller('sessions/:sessionId/cloud-resource-menu')
export class CloudMenuController {
  constructor(private readonly service: CloudMenuService) {}
  @Get() get(@Param('sessionId') sessionId: string) {
    return this.service.settings(sessionId);
  }
  @Put() save(@Param('sessionId') sessionId: string, @Body() dto: SaveCloudMenuDto) {
    return this.service.save(sessionId, dto);
  }
  @Post('rotate-token') rotate(@Param('sessionId') sessionId: string) {
    return this.service.rotateToken(sessionId);
  }
}

@Public()
@Controller('whatsapp-cloud-menus')
export class CloudMenuWebhookController {
  constructor(private readonly service: CloudMenuService) {}
  @Get(':id') @Header('Content-Type', 'text/plain') verify(
    @Param('id') id: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.service.verify(id, mode, token, challenge);
  }
  @Post(':id') @HttpCode(200) async receive(
    @Param('id') id: string,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    await this.service.receive(id, signature, req.rawBody);
    return { received: true };
  }
}
