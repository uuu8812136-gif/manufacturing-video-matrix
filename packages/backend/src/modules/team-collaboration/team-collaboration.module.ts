import { Module } from '@nestjs/common';
import { TeamCollaborationService } from './team-collaboration.service';
import { TeamCollaborationController } from './team-collaboration.controller';
import { DistributionModule } from '../distribution/distribution.module';

@Module({
  imports: [DistributionModule],
  controllers: [TeamCollaborationController],
  providers: [TeamCollaborationService],
})
export class TeamCollaborationModule {}
