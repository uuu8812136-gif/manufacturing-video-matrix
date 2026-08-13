import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HitRecreationService } from './hit-recreation.service';
import { AddPeerDto, GenerateRecreationsDto, UpdateRecreationDto, PublishRecreationDto, UpdateRecreationScoreDto, UpdatePeerDto } from './dto/hit.dto';
import { CurrentUser, Roles } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('智能爆款情报与二创引擎')
@Controller('hit-recreation')
export class HitRecreationController {
  constructor(private service: HitRecreationService) {}

  @Get('peers')
  @ApiOperation({ summary: '同行账号库' })
  listPeers(@CurrentUser() user: { teamId: string }) {
    return this.service.listPeers(user.teamId);
  }

  @Post('peers')
  @ApiOperation({ summary: '添加同行账号' })
  addPeer(@CurrentUser() user: { teamId: string }, @Body() dto: AddPeerDto) {
    return this.service.addPeer(user.teamId, dto);
  }

  @Patch('peers/:id')
  @ApiOperation({ summary: '更新同行账号' })
  updatePeer(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdatePeerDto) {
    return this.service.updatePeer(user.teamId, id, dto);
  }

  @Delete('peers/:id')
  @ApiOperation({ summary: '删除同行账号并保留历史爆款' })
  removePeer(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removePeer(user.teamId, id);
  }

  @Get('benchmarks')
  @ApiOperation({ summary: '行业标杆库' })
  benchmarks(@CurrentUser() user: { teamId: string }) {
    return this.service.benchmarks(user.teamId);
  }

  @Post('crawl')
  @ApiOperation({ summary: '抓取同行爆款' })
  crawl(@CurrentUser() user: { teamId: string }) {
    return this.service.crawlPeers(user.teamId);
  }

  @Get('hits')
  @ApiOperation({ summary: '爆款内容列表' })
  listHits(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listHits(user.teamId, query);
  }

  @Get('hits/:id')
  @ApiOperation({ summary: '爆款详情' })
  getHit(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.getHit(user.teamId, id);
  }

  @Post('hits/:id/teardown')
  @ApiOperation({ summary: 'AI 爆款拆解' })
  teardown(@CurrentUser() user: { id: string; teamId: string }, @Param('id') id: string) {
    return this.service.teardown(user.teamId, user.id, id);
  }

  @Post('recreations/generate')
  @ApiOperation({ summary: '生成二创内容(3-5版本)' })
  generate(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: GenerateRecreationsDto) {
    return this.service.generateRecreations(user.teamId, user.id, dto);
  }

  @Get('recreations')
  @ApiOperation({ summary: '二创内容列表(每日看板)' })
  listRecreations(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listRecreations(user.teamId, query);
  }

  @Get('recreations/:id')
  @ApiOperation({ summary: '二创详情(左右对比)' })
  getRecreation(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.getRecreation(user.teamId, id);
  }

  @Patch('recreations/:id')
  @ApiOperation({ summary: '在线微调' })
  update(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateRecreationDto) {
    return this.service.updateRecreation(user.teamId, id, dto);
  }

  @Delete('recreations/:id')
  @ApiOperation({ summary: '删除未发布的二创内容' })
  remove(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeRecreation(user.teamId, id);
  }

  @Post('recreations/:id/select')
  @ApiOperation({ summary: '选中二创' })
  select(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.selectRecreation(user.teamId, id);
  }

  @Post('recreations/:id/publish')
  @ApiOperation({ summary: '一键发布' })
  publish(
    @CurrentUser() user: { id: string; teamId: string },
    @Param('id') id: string,
    @Body() dto: PublishRecreationDto,
  ) {
    return this.service.publishRecreation(user.teamId, user.id, id, dto);
  }

  @Post('recreations/:id/score')
  @Roles('super_admin', 'ops_lead')
  @ApiOperation({ summary: '回流二创发布效果并计算评分' })
  updateScore(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateRecreationScoreDto) {
    return this.service.updateScore(user.teamId, id, dto);
  }

  @Get('flywheel/stats')
  @ApiOperation({ summary: '数据飞轮统计' })
  flywheel(@CurrentUser() user: { teamId: string }) {
    return this.service.flywheelStats(user.teamId);
  }
}
