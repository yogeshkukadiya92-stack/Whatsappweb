import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LeadFlowService } from './lead-flow.service';
import { CreateLeadFlowDto, UpdateLeadFlowDto } from './dto/lead-flow.dto';

@ApiTags('Lead Flows')
@Controller('sessions/:sessionId')
export class LeadFlowController {

  constructor(private readonly leadFlowService: LeadFlowService) {}

  @Get('lead-flows')
  @ApiOperation({ summary: 'List all lead flows for a session' })
  async getFlows(@Param('sessionId') sessionId: string) {
    return this.leadFlowService.findAllFlows(sessionId);
  }

  @Post('lead-flows')
  @ApiOperation({ summary: 'Create a new lead flow' })
  async createFlow(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateLeadFlowDto,
  ) {
    return this.leadFlowService.createFlow(sessionId, dto);
  }

  @Get('lead-flows/:id')
  @ApiOperation({ summary: 'Get a lead flow by ID' })
  async getFlow(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    return this.leadFlowService.findOneFlow(sessionId, id);
  }

  @Put('lead-flows/:id')
  @ApiOperation({ summary: 'Update a lead flow' })
  async updateFlow(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadFlowDto,
  ) {
    return this.leadFlowService.updateFlow(sessionId, id, dto);
  }

  @Delete('lead-flows/:id')
  @ApiOperation({ summary: 'Delete a lead flow' })
  async deleteFlow(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    return this.leadFlowService.removeFlow(sessionId, id);
  }

  // --- Leads Captured ---

  @Get('leads')
  @ApiOperation({ summary: 'List all captured leads for a session' })
  async getLeads(@Param('sessionId') sessionId: string) {
    return this.leadFlowService.findAllLeads(sessionId);
  }

  @Delete('leads/:id')
  @ApiOperation({ summary: 'Delete a captured lead' })
  async deleteLead(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ) {
    return this.leadFlowService.removeLead(sessionId, id);
  }

  @Get('leads-export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="leads.csv"')
  @ApiOperation({ summary: 'Export leads as CSV' })
  async exportCsv(@Param('sessionId') sessionId: string): Promise<string> {
    return this.leadFlowService.exportLeadsCsv(sessionId);
  }
}
