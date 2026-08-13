import { Controller, Get, Param, Post, Query, Res, Body } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { ConfigService } from '@nestjs/config';
import { assertSystemAdmin } from '../../common/utils/system-admin.util';

@ApiBearerAuth()
@ApiTags('系统')
@Controller('system')
export class SystemController {
  constructor(private service: SystemService, private config: ConfigService) {}

  @Get('audit-logs')
  @ApiOperation({ summary: '操作审计日志' })
  @Roles('super_admin', 'ops_lead')
  logs(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.auditLogs({ ...query, teamId: user.teamId });
  }

  @Get('notifications')
  @ApiOperation({ summary: '通知列表' })
  notifications(@CurrentUser() user: { teamId: string; id: string }) {
    return this.service.notifications(user.teamId, user.id);
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: '标记已读' })
  markRead(@CurrentUser() user: { teamId: string; id: string }, @Param('id') id: string) {
    return this.service.markRead(user.teamId, user.id, id);
  }

  @Get('backups')
  @ApiOperation({ summary: '备份记录列表' })
  @Roles('super_admin')
  backups(@CurrentUser() user: { phone: string }) {
    assertSystemAdmin(this.config, user.phone);
    return this.service.backups();
  }

  @Post('backups')
  @ApiOperation({ summary: '触发备份' })
  @Roles('super_admin')
  triggerBackup(@CurrentUser() user: { phone: string }, @Body() body: { type?: 'full' | 'incremental' }) {
    assertSystemAdmin(this.config, user.phone);
    return this.service.triggerBackup(body.type || 'full');
  }

  @Post('backups/:id/restore')
  @ApiOperation({ summary: '恢复备份' })
  @Roles('super_admin')
  restore(@CurrentUser() user: { phone: string }, @Param('id') id: string) {
    assertSystemAdmin(this.config, user.phone);
    return this.service.restoreBackup(id);
  }

  @Get('backups/:id/download')
  @ApiOperation({ summary: '下载备份文件' })
  @Roles('super_admin')
  async download(@CurrentUser() user: { phone: string }, @Param('id') id: string, @Res() res: Response) {
    assertSystemAdmin(this.config, user.phone);
    const { stream, filename, contentType, size } = await this.service.downloadBackup(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.on('error', (error) => {
      if (!res.headersSent) res.status(500);
      res.destroy(error);
    });
    stream.pipe(res);
  }
}
