import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ScheduledMessageService } from './scheduled-message.service';
import {
  CreateScheduledMessageDto,
  UpdateScheduledMessageDto,
} from './dto/scheduled-message.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { ScheduledMessage } from './entities/scheduled-message.entity';

@ApiTags('scheduled-messages')
@Controller('scheduled-messages')
export class ScheduledMessageController {
  constructor(private readonly scheduledService: ScheduledMessageService) {}

  @Get()
  @ApiOperation({ summary: 'Get all scheduled messages across sessions' })
  @ApiQuery({ name: 'sessionId', required: false, description: 'Filter by session ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (pending, sent, failed, cancelled, all)' })
  @ApiResponse({ status: 200, description: 'List of scheduled messages' })
  async listAll(
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
  ): Promise<ScheduledMessage[]> {
    return this.scheduledService.findAll({ sessionId, status });
  }
}

@ApiTags('scheduled-messages')
@Controller('sessions/:sessionId/scheduled-messages')
export class SessionScheduledMessageController {
  constructor(private readonly scheduledService: ScheduledMessageService) {}

  @Get()
  @ApiOperation({ summary: 'Get scheduled messages for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'List of scheduled messages for the session' })
  async list(
    @Param('sessionId') sessionId: string,
    @Query('status') status?: string,
  ): Promise<ScheduledMessage[]> {
    return this.scheduledService.findAll({ sessionId, status });
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new scheduled message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, description: 'Scheduled message created and persisted in database' })
  async create(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateScheduledMessageDto,
  ): Promise<ScheduledMessage> {
    return this.scheduledService.create(sessionId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single scheduled message by ID' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Scheduled message ID' })
  @ApiResponse({ status: 200, description: 'Scheduled message record' })
  async getOne(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ): Promise<ScheduledMessage> {
    return this.scheduledService.findOne(sessionId, id);
  }

  @Patch(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a scheduled message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Scheduled message ID' })
  @ApiResponse({ status: 200, description: 'Updated scheduled message' })
  async update(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledMessageDto,
  ): Promise<ScheduledMessage> {
    return this.scheduledService.update(sessionId, id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Cancel/Delete a scheduled message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Scheduled message ID' })
  @ApiResponse({ status: 200, description: 'Scheduled message cancelled' })
  async cancel(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ): Promise<ScheduledMessage> {
    return this.scheduledService.cancel(sessionId, id);
  }

  @Post(':id/send-now')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a scheduled message immediately' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Scheduled message ID' })
  @ApiResponse({ status: 200, description: 'Execution result' })
  async sendNow(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.scheduledService.sendNow(sessionId, id);
  }
}
