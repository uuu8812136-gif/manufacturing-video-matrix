import { Module } from '@nestjs/common';
import { AiCreationService } from './ai-creation.service';
import { AiCreationController } from './ai-creation.controller';
import { VideoProcessorService } from './video-processor.service';
import { TtsService } from './tts.service';
import { SttService } from './stt.service';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [SystemModule],
  controllers: [AiCreationController],
  providers: [AiCreationService, VideoProcessorService, TtsService, SttService],
  exports: [AiCreationService, VideoProcessorService],
})
export class AiCreationModule {}
