import { Module } from '@nestjs/common';
import { InteractionLeadsService } from './interaction-leads.service';
import { InteractionLeadsController } from './interaction-leads.controller';
import { NotifyService } from './notify.service';
import { CrmService } from './crm.service';

@Module({
  controllers: [InteractionLeadsController],
  providers: [InteractionLeadsService, NotifyService, CrmService],
  exports: [InteractionLeadsService],
})
export class InteractionLeadsModule {}
