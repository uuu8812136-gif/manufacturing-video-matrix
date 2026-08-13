import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeoService } from './geo.service';
import { CreateKeywordDto, AiCitationDto, CompetitorCompareDto, SeoAdviceDto } from './dto/geo.dto';
import { CurrentUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('GEO搜索获客')
@Controller('geo')
export class GeoController {
  constructor(private service: GeoService) {}

  @Get('keywords')
  @ApiOperation({ summary: '品牌关键词库' })
  keywords(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listKeywords(user.teamId, query);
  }

  @Post('keywords')
  @ApiOperation({ summary: '添加关键词' })
  createKeyword(@CurrentUser() user: { teamId: string }, @Body() dto: CreateKeywordDto) {
    return this.service.createKeyword(user.teamId, dto);
  }

  @Delete('keywords/:id')
  @ApiOperation({ summary: '删除关键词及监测记录' })
  removeKeyword(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeKeyword(user.teamId, id);
  }

  @Post('keywords/:id/check')
  @ApiOperation({ summary: '监测关键词排名' })
  check(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.checkRank(user.teamId, id);
  }

  @Get('capabilities')
  @ApiOperation({ summary: '查看 GEO 搜索引擎能力与不支持原因' })
  capabilities() {
    return this.service.searchCapabilities();
  }

  @Post('keywords/:id/ai-citation')
  @ApiOperation({ summary: 'AI 平台引用检测' })
  aiCitation(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: AiCitationDto) {
    return this.service.checkAiCitation(user.teamId, id, dto.aiPlatform);
  }

  @Get('rank-tracking')
  @ApiOperation({ summary: '排名追踪' })
  tracking(@CurrentUser() user: { teamId: string }) {
    return this.service.rankTracking(user.teamId);
  }

  @Get('dual-engine')
  @ApiOperation({ summary: '双引擎数据看板' })
  dualEngine(@CurrentUser() user: { teamId: string }) {
    return this.service.dualEngineDashboard(user.teamId);
  }

  @Get('competitor-compare')
  @ApiOperation({ summary: '竞品关键词排名对比' })
  competitorCompare(@CurrentUser() user: { teamId: string }, @Query() dto: CompetitorCompareDto) {
    return this.service.competitorCompare(user.teamId, dto.keyword, dto.competitor);
  }

  @Get('seo-advice')
  @ApiOperation({ summary: 'AI 生成 SEO 优化建议' })
  seoAdvice(@Query() dto: SeoAdviceDto) {
    return this.service.seoAdvice(dto.keyword);
  }

  @Post('monthly-report')
  @ApiOperation({ summary: '生成月度报告' })
  report(@CurrentUser() user: { teamId: string }) {
    return this.service.monthlyReport(user.teamId);
  }
}
