import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiBotService } from './ai-bot.service';
import { UpdateAiBotConfigDto, TestAiBotPromptDto } from './dto/ai-bot.dto';

@ApiTags('AI Bot')
@Controller('sessions/:sessionId/ai-bot')
export class AiBotController {

  constructor(private readonly aiBotService: AiBotService) {}

  @Get()
  @ApiOperation({ summary: 'Get AI bot configuration for a session' })
  async getConfig(@Param('sessionId') sessionId: string) {
    return this.aiBotService.getMaskedConfig(sessionId);
  }

  @Put()
  @ApiOperation({ summary: 'Update AI bot configuration for a session' })
  async updateConfig(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateAiBotConfigDto,
  ) {
    return this.aiBotService.updateConfig(sessionId, dto);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test prompt and knowledge base response with AI' })
  async testPrompt(
    @Param('sessionId') sessionId: string,
    @Body() dto: TestAiBotPromptDto,
  ) {
    return this.aiBotService.testPrompt(sessionId, dto.message);
  }
}
