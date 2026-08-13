import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { CryptoUtil } from './common/utils/crypto.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  CryptoUtil.init(config);

  const prefix = config.get<string>('API_PREFIX') || 'api';
  app.setGlobalPrefix(prefix);

  app.use(helmet());
  app.use(compression());
  const nodeEnv = config.get<string>('NODE_ENV') || 'development';
  const configuredOrigins = (config.get<string>('CORS_ORIGIN') || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (nodeEnv === 'production' && configuredOrigins.length === 0) {
    throw new Error('生产环境必须配置 CORS_ORIGIN');
  }
  app.enableCors({
    origin: configuredOrigins.length ? configuredOrigins : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: nodeEnv === 'production',
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(config.get<string>('APP_NAME') || '制造业短视频矩阵智能分发系统')
    .setDescription('社媒分发 + GEO搜索获客双引擎 · 数字人IP · 智能爆款二创')
    .setVersion('2.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  const port = Number(config.get<string>('PORT') || 3000);
  await app.listen(port);
  Logger.log(`🚀 后端运行于 http://localhost:${port}/${prefix}`, 'Bootstrap');
  Logger.log(`📖 Swagger 文档 http://localhost:${port}/${prefix}/docs`, 'Bootstrap');
}

bootstrap();
