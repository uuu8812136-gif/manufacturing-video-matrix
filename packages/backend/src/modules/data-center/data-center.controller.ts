import { Controller, Get, Post, Res, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DataCenterService } from './data-center.service';
import { CurrentUser, Roles } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('数据中心')
@Controller('data-center')
export class DataCenterController {
  constructor(private service: DataCenterService) {}

  @Get('overview')
  @ApiOperation({ summary: '数据总览' })
  overview(@CurrentUser() user: { teamId: string }) {
    return this.service.overview(user.teamId);
  }

  @Get('trend')
  @ApiOperation({ summary: '趋势图' })
  trend(@CurrentUser() user: { teamId: string }, @Query('days') days?: string) {
    return this.service.trend(user.teamId, Number(days) || 7);
  }

  @Get('account-ranking')
  @ApiOperation({ summary: '账号数据排名' })
  ranking(@CurrentUser() user: { teamId: string }) {
    return this.service.accountRanking(user.teamId);
  }

  @Get('employee')
  @ApiOperation({ summary: '员工数据' })
  employee(@CurrentUser() user: { teamId: string }) {
    return this.service.employeeData(user.teamId);
  }

  @Get('content-performance')
  @ApiOperation({ summary: '内容分发效果' })
  contentPerformance(@CurrentUser() user: { teamId: string }) {
    return this.service.contentPerformance(user.teamId);
  }

  @Get('hot-topics')
  @ApiOperation({ summary: '全平台热点榜单' })
  hotTopics(@Query('platform') platform?: string) {
    return this.service.hotTopics(platform);
  }

  @Post('hot-topics/sync')
  @Roles('super_admin', 'ops_lead')
  @ApiOperation({ summary: '手动同步热点榜单' })
  syncHotTopics() {
    return this.service.syncHotTopics();
  }

  @Get('export')
  @ApiOperation({ summary: '导出 Excel' })
  async export(@CurrentUser() user: { teamId: string }, @Res() res: Response) {
    const buffer = await this.service.exportExcel(user.teamId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=account-data.xlsx');
    res.send(buffer);
  }
}
