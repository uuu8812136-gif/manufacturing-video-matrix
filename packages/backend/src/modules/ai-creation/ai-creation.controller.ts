import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiCreationService } from './ai-creation.service';
import { GenerateScriptDto, GenerateTitlesDto, GenerateTagsDto, SensitiveCheckDto, CreateMaterialDto, ExtractTextDto, SynthesizeVoiceDto, MixcutDto, AdaptRatioDto, MultiVersionsDto, VideoToolDto } from './dto/ai.dto';
import { CurrentUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('AI内容创作')
@Controller('ai-creation')
export class AiCreationController {
  constructor(private aiService: AiCreationService) {}

  @Get('templates')
  @ApiOperation({ summary: '制造业提示词模板库' })
  templates() {
    return this.aiService.templates();
  }

  @Post('generate-script')
  @ApiOperation({ summary: 'AI 生成脚本/文案' })
  generateScript(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: GenerateScriptDto) {
    return this.aiService.generateScript(user.teamId, user.id, dto);
  }

  @Post('generate-titles')
  @ApiOperation({ summary: 'AI 生成标题' })
  generateTitles(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: GenerateTitlesDto) {
    return this.aiService.generateTitles(user.teamId, user.id, dto);
  }

  @Post('generate-tags')
  @ApiOperation({ summary: 'AI 生成话题标签' })
  generateTags(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: GenerateTagsDto) {
    return this.aiService.generateTags(user.teamId, user.id, dto);
  }

  @Post('sensitive-check')
  @ApiOperation({ summary: '敏感词检测' })
  sensitiveCheck(@Body() dto: SensitiveCheckDto) {
    return this.aiService.sensitiveCheck(dto.text);
  }

  @Get('materials')
  @ApiOperation({ summary: '素材库' })
  materials(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.aiService.listMaterials(user.teamId, query);
  }

  @Post('materials')
  @ApiOperation({ summary: '上传素材' })
  createMaterial(@CurrentUser() user: { teamId: string }, @Body() dto: CreateMaterialDto) {
    return this.aiService.createMaterial(user.teamId, dto);
  }

  @Delete('materials/:id')
  @ApiOperation({ summary: '删除素材' })
  removeMaterial(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.aiService.removeMaterial(user.teamId, id);
  }

  @Post('extract-text')
  @ApiOperation({ summary: '视频文案提取（STT）' })
  extractText(@Body() dto: ExtractTextDto) {
    return this.aiService.extractText(dto.videoUrl);
  }

  @Post('synthesize-voice')
  @ApiOperation({ summary: '文本转语音（TTS）' })
  synthesizeVoice(@Body() dto: SynthesizeVoiceDto) {
    return this.aiService.synthesizeVoice(dto.text, dto.voice, { rate: dto.rate, pitch: dto.pitch });
  }

  @Post('mixcut')
  @ApiOperation({ summary: '视频混剪拼接' })
  mixcut(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: MixcutDto) {
    return this.aiService.mixcutClips(user.teamId, user.id, dto.clips, { watermark: dto.watermark, ratio: dto.ratio });
  }

  @Post('adapt-ratio')
  @ApiOperation({ summary: '视频比例适配' })
  adaptRatio(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: AdaptRatioDto) {
    return this.aiService.adaptVideoRatio(user.teamId, user.id, dto.videoUrl, dto.ratio);
  }

  @Post('video-tool')
  @ApiOperation({ summary: '视频转 GIF / 变速 / 裁剪工具箱' })
  videoTool(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: VideoToolDto) {
    return this.aiService.videoTool(user.teamId, user.id, dto);
  }

  @Post('multi-versions')
  @ApiOperation({ summary: 'AI 生成多版本脚本' })
  multiVersions(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: MultiVersionsDto) {
    return this.aiService.generateMultiVersions(user.teamId, user.id, dto);
  }
}
