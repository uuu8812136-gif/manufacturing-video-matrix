import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelService } from './channel.service';
import { CreateChannelDto, CreateCodeDto, SettleDto, MarkPaidDto } from './dto/channel.dto';
import { CurrentUser, Roles } from '../../common/decorators';
import { ConfigService } from '@nestjs/config';
import { assertSystemAdmin } from '../../common/utils/system-admin.util';

@ApiBearerAuth()
@ApiTags('渠道合作体系')
@Controller('channels')
@Roles('super_admin')
export class ChannelController {
  constructor(private service: ChannelService, private config: ConfigService) {}

  private authorize(phone: string) {
    assertSystemAdmin(this.config, phone);
  }

  @Get()
  @ApiOperation({ summary: '渠道列表(园区/协会)' })
  list(@CurrentUser() user: { phone: string }, @Query() query: Record<string, unknown>) {
    this.authorize(user.phone);
    return this.service.listChannels(query);
  }

  @Post()
  @ApiOperation({ summary: '创建渠道' })
  create(@CurrentUser() user: { phone: string }, @Body() dto: CreateChannelDto) {
    this.authorize(user.phone);
    return this.service.createChannel(dto);
  }

  @Get('codes')
  @ApiOperation({ summary: '邀请码列表' })
  codes(@CurrentUser() user: { phone: string }, @Query('channelId') channelId?: string) {
    this.authorize(user.phone);
    return this.service.listCodes(channelId);
  }

  @Post('codes')
  @ApiOperation({ summary: '生成邀请码' })
  createCode(@CurrentUser() user: { phone: string }, @Body() dto: CreateCodeDto) {
    this.authorize(user.phone);
    return this.service.createCode(dto);
  }

  @Get('report')
  @ApiOperation({ summary: '渠道报表/分润' })
  report(@CurrentUser() user: { phone: string }, @Query('channelId') channelId?: string) {
    this.authorize(user.phone);
    return this.service.report(channelId);
  }

  @Post('customers/:id/settle')
  @ApiOperation({ summary: '返佣结算' })
  settle(@CurrentUser() user: { phone: string }, @Param('id') id: string, @Body() dto: SettleDto) {
    this.authorize(user.phone);
    return this.service.settle(id, dto);
  }

  @Get('customers')
  @ApiOperation({ summary: '渠道注册客户与返佣明细' })
  customers(@CurrentUser() user: { phone: string }) {
    this.authorize(user.phone);
    return this.service.customers();
  }

  @Post('customers/:id/paid')
  @ApiOperation({ summary: '登记客户付费并自动计算返佣' })
  markPaid(@CurrentUser() user: { phone: string }, @Param('id') id: string, @Body() dto: MarkPaidDto) {
    this.authorize(user.phone);
    return this.service.markPaid(id, dto.amount);
  }
}
