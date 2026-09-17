import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRuleController } from './automation-rule.controller';
import { AiBotService } from './ai-bot.service';
import { AiBotController } from './ai-bot.controller';
import { LeadFlowService } from './lead-flow.service';
import { LeadFlowController } from './lead-flow.controller';
import { StudioWorkflow, StudioExecution, StudioJob } from './entities/studio-workflow.entity';
import { StudioWorkflowService } from './studio-workflow.service';
import { StudioWorkflowController, StudioHookController } from './studio-workflow.controller';
import { StudioAiService } from './studio-ai.service';
import { StudioConnection } from './entities/studio-connection.entity';
import { StudioConnectionService } from './studio-connection.service';
import { StudioConnectionController } from './studio-connection.controller';
import { StudioPlannerService } from './studio-planner.service';

/**
 * Deliberately imports no feature module: SessionModule imports this one (the projector fires rule
 * evaluation), so anything imported here must not lead back to SessionModule. The reply dependency
 * (MessageService) is resolved lazily via ModuleRef inside the service for exactly that reason.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AutomationRule,
        AiBotConfig,
        LeadFlow,
        LeadEntry,
        AiAgent,
        StudioWorkflow,
        StudioExecution,
        StudioJob,
        StudioConnection,
      ],
      'data',
    ),
  ],
  controllers: [
    AutomationRuleController,
    AiBotController,
    LeadFlowController,
    StudioWorkflowController,
    StudioHookController,
    StudioConnectionController,
  ],
  providers: [
    AutomationRulesService,
    AiBotService,
    LeadFlowService,
    StudioWorkflowService,
    StudioAiService,
    StudioConnectionService,
    StudioPlannerService,
  ],
  exports: [AutomationRulesService, AiBotService, LeadFlowService, StudioWorkflowService],
})
export class AutomationModule {}
