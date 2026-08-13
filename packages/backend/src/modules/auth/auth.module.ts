import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configured = config.get<string>('JWT_SECRET') || '';
        if (config.get<string>('NODE_ENV') === 'production' && configured.length < 32) {
          throw new Error('生产环境 JWT_SECRET 至少需要 32 个字符');
        }
        return {
          secret: configured || 'fallback-secret',
          signOptions: { expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES') || '15m') as JwtSignOptions['expiresIn'] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
