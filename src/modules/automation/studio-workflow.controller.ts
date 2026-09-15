import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireRole, Public } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { StudioWorkflowService } from './studio-workflow.service';
import { SaveStudioWorkflowDto, TestStudioWorkflowDto } from './dto/studio-workflow.dto';
import { GenerateStudioDraftDto, StudioPlannerService } from './studio-planner.service';
import { Optional } from '@nestjs/common';

@ApiTags('Automation Studio')
@RequireRole(ApiKeyRole.OPERATOR)
@Controller('sessions/:sessionId/studio-workflows')
export class StudioWorkflowController {
  constructor(
    private readonly studio: StudioWorkflowService,
    @Optional() private readonly planner?: StudioPlannerService,
  ) {}
  @Post('generate') generate(@Param('sessionId') sessionId: string, @Body() dto: GenerateStudioDraftDto) {
    if (!this.planner) throw new Error('AI planner is unavailable.');
    return this.planner.generate(sessionId, dto);
  }
  @Get() list(@Param('sessionId') sessionId: string) {
    return this.studio.list(sessionId);
  }
  @Get('executions') logs(@Param('sessionId') sessionId: string) {
    return this.studio.logs(sessionId);
  }
  @Post('executions/:executionId/cancel') @HttpCode(204) async cancel(
    @Param('sessionId') sessionId: string,
    @Param('executionId') id: string,
  ) {
    await this.studio.cancel(sessionId, id);
  }
  @Post(':id/webhook-token') rotate(@Param('sessionId') sessionId: string, @Param('id') id: string) {
    return this.studio.rotateWebhook(sessionId, id);
  }
  @Post() create(@Param('sessionId') sessionId: string, @Body() dto: SaveStudioWorkflowDto) {
    return this.studio.save(sessionId, dto);
  }
  @Put(':id') update(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: SaveStudioWorkflowDto,
  ) {
    return this.studio.save(sessionId, dto, id);
  }
  @Delete(':id') @HttpCode(204) async remove(@Param('sessionId') sessionId: string, @Param('id') id: string) {
    await this.studio.remove(sessionId, id);
  }
  @Post(':id/test') async test(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: TestStudioWorkflowDto,
  ) {
    return this.studio.execute(
      await this.studio.get(sessionId, id),
      dto.message,
      dto.chatId || 'test@c.us',
      undefined,
      dto.webhook,
    );
  }
}

@ApiTags('Automation Studio Webhooks')
@Controller('studio-hooks')
export class StudioHookController {
  constructor(private readonly studio: StudioWorkflowService) {}
  @Public() @Post(':id') @HttpCode(202) receive(
    @Param('id') id: string,
    @Headers('x-workflow-token') token: string,
    @Body() payload: unknown,
  ) {
    return this.studio.receiveWebhook(id, token, payload);
  }
}
