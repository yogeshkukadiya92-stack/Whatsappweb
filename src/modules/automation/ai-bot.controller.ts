import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiBotService } from './ai-bot.service';
import { UpdateAiBotConfigDto, TestAiBotPromptDto, ExtractDocumentDto } from './dto/ai-bot.dto';
import { CreateAiAgentDto, UpdateAiAgentDto } from './dto/ai-agent.dto';

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
    return this.aiBotService.testPrompt(sessionId, dto.message, dto.agentId);
  }

  @Post('extract-document')
  @ApiOperation({ summary: 'Extract structured text from uploaded Word, Excel, PDF, CSV or text file' })
  async extractDocument(
    @Body() dto: ExtractDocumentDto,
  ) {
    return this.aiBotService.extractDocument(dto);
  }

  // =========================================================================
  // Multi-Agent Endpoints
  // =========================================================================

  @Get('agents')
  @ApiOperation({ summary: 'List all specialized AI agents for a session' })
  async listAgents(@Param('sessionId') sessionId: string) {
    return this.aiBotService.listAgents(sessionId);
  }

  @Post('agents')
  @ApiOperation({ summary: 'Create a new specialized AI agent' })
  async createAgent(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateAiAgentDto,
  ) {
    return this.aiBotService.createAgent(sessionId, dto);
  }

  @Put('agents/:agentId')
  @ApiOperation({ summary: 'Update an existing specialized AI agent' })
  async updateAgent(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAiAgentDto,
  ) {
    return this.aiBotService.updateAgent(agentId, dto);
  }

  @Delete('agents/:agentId')
  @ApiOperation({ summary: 'Delete a specialized AI agent' })
  async deleteAgent(@Param('agentId') agentId: string) {
    return { success: await this.aiBotService.deleteAgent(agentId) };
  }

  @Get('query-captures')
  async queryCaptures(@Param('sessionId') sessionId: string) { return this.aiBotService.listQueryCaptures(sessionId); }

  @Get('query-captures/export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="ai-query-report.csv"')
  async exportQueryCaptures(@Param('sessionId') sessionId: string): Promise<string> {
    return this.aiBotService.exportQueryCapturesCsv(sessionId);
  }
}
