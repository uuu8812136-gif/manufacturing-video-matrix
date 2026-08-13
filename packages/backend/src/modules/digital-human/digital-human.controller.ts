import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DigitalHumanService } from './digital-human.service';
import {
  CreateAvatarDto,
  CreateIpDto,
  GenerateVideoDto,
  ReplaceBackgroundDto,
  DigitalHumanMixcutDto,
  PublishDigitalHumanDto,
  UpdateAvatarDto,
  UpdateIpDto,
} from './dto/digital-human.dto';
import { CurrentUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('数字人IP引擎')
@Controller('digital-human')
export class DigitalHumanController {
  constructor(private service: DigitalHumanService) {}

  @Get('avatars')
  @ApiOperation({ summary: '数字人形象库' })
  avatars(@CurrentUser() user: { teamId: string }) {
    return this.service.listAvatars(user.teamId);
  }

  @Post('avatars')
  @ApiOperation({ summary: '创建/定制数字人形象' })
  createAvatar(@CurrentUser() user: { teamId: string }, @Body() dto: CreateAvatarDto) {
    return this.service.createAvatar(user.teamId, dto);
  }

  @Patch('avatars/:id')
  @ApiOperation({ summary: '更新数字人形象' })
  updateAvatar(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateAvatarDto) {
    return this.service.updateAvatar(user.teamId, id, dto);
  }

  @Delete('avatars/:id')
  @ApiOperation({ summary: '删除未绑定的数字人形象' })
  removeAvatar(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeAvatar(user.teamId, id);
  }

  @Get('ips')
  @ApiOperation({ summary: '数字人 IP 矩阵' })
  ips(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listIps(user.teamId, query);
  }

  @Post('ips')
  @ApiOperation({ summary: '创建数字人 IP' })
  createIp(@CurrentUser() user: { teamId: string }, @Body() dto: CreateIpDto) {
    return this.service.createIp(user.teamId, dto);
  }

  @Patch('ips/:id')
  @ApiOperation({ summary: '更新数字人 IP' })
  updateIp(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateIpDto) {
    return this.service.updateIp(user.teamId, id, dto);
  }

  @Delete('ips/:id')
  @ApiOperation({ summary: '删除无生成任务的数字人 IP' })
  removeIp(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeIp(user.teamId, id);
  }

  @Post('generate')
  @ApiOperation({ summary: '文案驱动数字人生成视频' })
  generate(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: GenerateVideoDto) {
    return this.service.generateVideo(user.teamId, user.id, dto);
  }

  @Get('tasks')
  @ApiOperation({ summary: '数字人视频任务' })
  tasks(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listTasks(user.teamId, query);
  }

  @Delete('tasks/:id')
  @ApiOperation({ summary: '删除已结束的数字人任务' })
  removeTask(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeTask(user.teamId, id);
  }

  @Post('tasks/:id/publish')
  @ApiOperation({ summary: '数字人视频直接进入发布队列' })
  publishTask(@CurrentUser() user: { id: string; teamId: string }, @Param('id') id: string, @Body() dto: PublishDigitalHumanDto) {
    return this.service.publishTask(user.teamId, user.id, id, dto.accountIds, dto.scheduledAt);
  }

  @Get('strategy')
  @ApiOperation({ summary: '混合矩阵策略建议' })
  strategy(@CurrentUser() user: { teamId: string }) {
    return this.service.strategyAdvice(user.teamId);
  }

  @Post('replace-background')
  @ApiOperation({ summary: '绿幕抠像背景替换' })
  replaceBackground(@CurrentUser() user: { teamId: string }, @Body() dto: ReplaceBackgroundDto) {
    return this.service.replaceBackground(user.teamId, dto.videoUrl, dto.bgUrl);
  }

  @Post('mixcut')
  @ApiOperation({ summary: '多数字人 IP 混剪' })
  mixcut(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: DigitalHumanMixcutDto) {
    return this.service.mixcut(user.teamId, user.id, dto.avatarIds, dto.script);
  }
}
