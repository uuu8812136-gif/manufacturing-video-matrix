import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MfaEnableDto, MfaVerifyDto } from './dto/mfa.dto';
import { Public, CurrentUser } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('mfa/verify')
  @ApiOperation({ summary: 'MFA 二次验证' })
  mfaVerify(@Body() dto: MfaVerifyDto) {
    return this.authService.mfaVerify(dto.mfaToken, dto.code);
  }

  @ApiBearerAuth()
  @Get('mfa/setup')
  @ApiOperation({ summary: '获取 MFA 密钥' })
  mfaSetup(@CurrentUser() user: RequestUser) {
    return this.authService.mfaSetup(user.id);
  }

  @ApiBearerAuth()
  @Post('mfa/enable')
  @ApiOperation({ summary: '开启 MFA' })
  mfaEnable(@CurrentUser() user: RequestUser, @Body() dto: MfaEnableDto) {
    return this.authService.mfaEnable(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Post('mfa/disable')
  @ApiOperation({ summary: '关闭 MFA' })
  mfaDisable(@CurrentUser() user: RequestUser) {
    return this.authService.mfaDisable(user.id);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌' })
  refresh(@Body('refreshToken') token: string) {
    return this.authService.refresh(token);
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: '退出登录' })
  logout(@Body('refreshToken') token?: string) {
    return this.authService.logout(token);
  }
}
