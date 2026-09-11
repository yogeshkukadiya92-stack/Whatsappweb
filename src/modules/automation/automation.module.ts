import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRuleController } from './automation-rule.controller';
import { AiBotService } from './ai-bot.service';
import { AiBotController } from './ai-bot.controller';
import { LeadFlowService } from './lead-flow.service';
import { LeadFlowController } from './lead-flow.controller';

/**
 * Deliberately imports no feature module: SessionModule imports this one (the projector fires rule
 * evaluation), so anything imported here must not lead back to SessionModule. The reply dependency
 * (MessageService) is resolved lazily via ModuleRef inside the service for exactly that reason.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [AutomationRule, AiBotConfig, LeadFlow, LeadEntry],
      'data',
    ),
  ],
  controllers: [AutomationRuleController, AiBotController, LeadFlowController],
  providers: [AutomationRulesService, AiBotService, LeadFlowService],
  exports: [AutomationRulesService, AiBotService, LeadFlowService],
})
export class AutomationModule {}

