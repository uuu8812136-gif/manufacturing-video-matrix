import { Global, Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { BackupService } from './backup.service';
import { MinioService } from './minio.service';
import { AssetsController } from './assets.controller';

@Global()
@Module({
  controllers: [SystemController, AssetsController],
  providers: [SystemService, BackupService, MinioService],
  exports: [SystemService, BackupService, MinioService],
})
export class SystemModule {}
