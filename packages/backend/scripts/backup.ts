import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BackupService } from '../src/modules/system/backup.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  const backup = app.get(BackupService);
  const type = (process.argv[2] as 'full' | 'incremental') || 'full';
  try {
    if (type === 'full') {
      const r = await backup.backupFull();
      console.log('全量备份完成:', r);
    } else {
      const r = await backup.backupIncremental();
      console.log('增量备份完成:', r);
    }
  } catch (e) {
    console.error('备份失败:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
bootstrap();
