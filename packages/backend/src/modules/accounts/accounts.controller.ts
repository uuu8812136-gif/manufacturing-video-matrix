import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { BindAccountDto, UpdateAccountDto, CreateGroupDto, CreateRegionDto, ExchangeOAuthDto, PushdownDto, BrowserLoginStartDto, UpdateGroupDto, UpdateRegionDto } from './dto/account.dto';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { RequestUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('账号矩阵管理')
@Controller('accounts')
@UseGuards(RolesGuard)
export class AccountsController {
  constructor(private accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: '账号列表' })
  list(@CurrentUser() user: RequestUser, @Query() query: Record<string, unknown>) {
    return this.accountsService.list(user.teamId, query);
  }

  @Post()
  @ApiOperation({ summary: '绑定账号' })
  @Roles('super_admin', 'ops_lead')
  bind(@CurrentUser() user: RequestUser, @Body() dto: BindAccountDto) {
    return this.accountsService.bind(user.teamId, dto);
  }

  @Post('oauth/exchange')
  @ApiOperation({ summary: '使用 OAuth 授权码绑定账号' })
  @Roles('super_admin', 'ops_lead')
  exchangeOAuth(@CurrentUser() user: RequestUser, @Body() dto: ExchangeOAuthDto) {
    return this.accountsService.exchangeOAuth(user.teamId, user.id, dto);
  }

  @Get('oauth/authorize-url')
  @ApiOperation({ summary: '生成平台 OAuth/扫码授权地址' })
  @Roles('super_admin', 'ops_lead')
  oauthAuthorizeUrl(@CurrentUser() user: RequestUser, @Query('platform') platform: string, @Query('redirectUri') redirectUri: string) {
    return this.accountsService.oauthAuthorizationUrl(user.teamId, user.id, platform, redirectUri);
  }

  @Post('scan/start')
  @ApiOperation({ summary: '启动官方网页二维码扫码登录' })
  @Roles('super_admin', 'ops_lead')
  startBrowserLogin(@CurrentUser() user: RequestUser, @Body() dto: BrowserLoginStartDto) {
    return this.accountsService.startBrowserLogin(user.teamId, user.id, dto);
  }

  @Get('scan/:sessionId/status')
  @ApiOperation({ summary: '轮询浏览器扫码登录状态' })
  @Roles('super_admin', 'ops_lead')
  browserLoginStatus(@CurrentUser() user: RequestUser, @Param('sessionId') sessionId: string) {
    return this.accountsService.browserLoginStatus(user.teamId, user.id, sessionId);
  }

  @Delete('scan/:sessionId')
  @ApiOperation({ summary: '取消浏览器扫码登录' })
  @Roles('super_admin', 'ops_lead')
  cancelBrowserLogin(@CurrentUser() user: RequestUser, @Param('sessionId') sessionId: string) {
    return this.accountsService.cancelBrowserLogin(user.teamId, user.id, sessionId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新账号' })
  @Roles('super_admin', 'ops_lead')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(user.teamId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账号' })
  @Roles('super_admin', 'ops_lead')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accountsService.remove(user.teamId, id);
  }

  @Post(':id/refresh')
  @ApiOperation({ summary: '刷新登录态' })
  @Roles('super_admin', 'ops_lead')
  refresh(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accountsService.refreshStatus(user.teamId, id);
  }

  @Get('groups')
  @ApiOperation({ summary: '账号分组' })
  groups(@CurrentUser() user: RequestUser) {
    return this.accountsService.listGroups(user.teamId);
  }

  @Post('groups')
  @ApiOperation({ summary: '创建分组' })
  @Roles('super_admin', 'ops_lead')
  createGroup(@CurrentUser() user: RequestUser, @Body() dto: CreateGroupDto) {
    return this.accountsService.createGroup(user.teamId, dto);
  }

  @Patch('groups/:id')
  @ApiOperation({ summary: '更新账号分组' })
  @Roles('super_admin', 'ops_lead')
  updateGroup(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.accountsService.updateGroup(user.teamId, id, dto);
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: '删除空账号分组' })
  @Roles('super_admin', 'ops_lead')
  removeGroup(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accountsService.removeGroup(user.teamId, id);
  }

  @Get('regions')
  @ApiOperation({ summary: '区域列表' })
  regions(@CurrentUser() user: RequestUser) {
    return this.accountsService.listRegions(user.teamId);
  }

  @Post('regions')
  @ApiOperation({ summary: '创建区域' })
  @Roles('super_admin', 'ops_lead')
  createRegion(@CurrentUser() user: RequestUser, @Body() dto: CreateRegionDto) {
    return this.accountsService.createRegion(user.teamId, dto);
  }

  @Patch('regions/:id')
  @ApiOperation({ summary: '更新区域' })
  @Roles('super_admin', 'ops_lead')
  updateRegion(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateRegionDto) {
    return this.accountsService.updateRegion(user.teamId, id, dto);
  }

  @Delete('regions/:id')
  @ApiOperation({ summary: '删除未使用的区域' })
  @Roles('super_admin', 'ops_lead')
  removeRegion(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accountsService.removeRegion(user.teamId, id);
  }

  @Get('dealer/dashboard')
  @ApiOperation({ summary: '经销商数据看板' })
  dealerDashboard(@CurrentUser() user: RequestUser) {
    return this.accountsService.dealerDashboard(user.teamId);
  }

  @Post('dealer/pushdown')
  @ApiOperation({ summary: '总部内容下发经销商' })
  @Roles('super_admin', 'ops_lead')
  pushdown(@CurrentUser() user: RequestUser, @Body() dto: PushdownDto) {
    const accountIds = Object.values(dto.accountIds).flat();
    return this.accountsService.pushdown(user.teamId, user.id, dto.contentId, accountIds);
  }
}
