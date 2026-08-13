import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InteractionLeadsService } from './interaction-leads.service';
import {
  CreateLeadFormDto,
  UpdateLeadFormDto,
  SubmitLeadDto,
  UpdateLeadDto,
  AssignLeadDto,
  FollowUpDto,
  CreateAutoReplyDto,
  UpdateAutoReplyDto,
  CreateWebhookDto,
  UpdateWebhookDto,
  CrmConfigDto,
} from './dto/lead.dto';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { Throttle } from '@nestjs/throttler';

@ApiBearerAuth()
@ApiTags('互动管理与线索闭环')
@Controller()
export class InteractionLeadsController {
  constructor(private service: InteractionLeadsService) {}

  @Get('comments')
  @ApiOperation({ summary: '评论聚合' })
  comments(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listComments(user.teamId, query);
  }

  @Post('interactions/sync')
  @Roles('super_admin', 'ops_lead')
  @ApiOperation({ summary: '手动同步全部平台评论和私信' })
  syncInteractions() {
    return this.service.syncInteractions();
  }

  @Post('comments/:id/reply')
  @ApiOperation({ summary: '回复评论' })
  replyComment(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body('text') text: string) {
    return this.service.replyComment(user.teamId, id, text);
  }

  @Get('messages')
  @ApiOperation({ summary: '私信聚合' })
  messages(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listMessages(user.teamId, query);
  }

  @Post('messages/:id/reply')
  @ApiOperation({ summary: '回复私信' })
  replyMessage(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body('text') text: string) {
    return this.service.replyMessage(user.teamId, id, text);
  }

  @Post('ai-suggest-reply')
  @ApiOperation({ summary: 'AI 智能回复建议' })
  aiSuggest(@Body('context') context: string) {
    return this.service.aiSuggestReply(context);
  }

  @Get('auto-reply')
  @ApiOperation({ summary: '自动回复规则' })
  autoReply(@CurrentUser() user: { teamId: string }) {
    return this.service.listAutoReply(user.teamId);
  }

  @Post('auto-reply')
  @ApiOperation({ summary: '创建自动回复规则' })
  createAutoReply(@CurrentUser() user: { teamId: string }, @Body() dto: CreateAutoReplyDto) {
    return this.service.createAutoReply(user.teamId, dto);
  }

  @Patch('auto-reply/:id')
  @ApiOperation({ summary: '更新/启停自动回复规则' })
  updateAutoReply(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateAutoReplyDto) {
    return this.service.updateAutoReply(user.teamId, id, dto);
  }

  @Delete('auto-reply/:id')
  @ApiOperation({ summary: '删除自动回复规则' })
  removeAutoReply(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeAutoReply(user.teamId, id);
  }

  @Get('lead-forms')
  @ApiOperation({ summary: '留资表单列表' })
  forms(@CurrentUser() user: { teamId: string }) {
    return this.service.listForms(user.teamId);
  }

  @Public()
  @Get('lead-forms/:id')
  @ApiOperation({ summary: '公开获取留资表单(按 id)' })
  getPublicForm(@Param('id') id: string) {
    return this.service.getFormById(id);
  }

  @Post('lead-forms')
  @ApiOperation({ summary: '创建留资表单' })
  createForm(@CurrentUser() user: { teamId: string }, @Body() dto: CreateLeadFormDto) {
    return this.service.createForm(user.teamId, dto);
  }

  @Patch('lead-forms/:id')
  @ApiOperation({ summary: '更新/启停留资表单' })
  updateForm(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateLeadFormDto) {
    return this.service.updateForm(user.teamId, id, dto);
  }

  @Delete('lead-forms/:id')
  @ApiOperation({ summary: '删除无历史线索的留资表单' })
  removeForm(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeForm(user.teamId, id);
  }

  @Public()
  @Post('lead-forms/submit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '提交留资(公开)' })
  submitLead(@Body() dto: SubmitLeadDto) {
    return this.service.submitLead(dto);
  }

  @Get('leads')
  @ApiOperation({ summary: '线索池' })
  leads(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listLeads(user.teamId, query);
  }

  @Patch('leads/:id')
  @ApiOperation({ summary: '更新线索' })
  updateLead(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.service.updateLead(user.teamId, id, dto);
  }

  @Post('leads/:id/assign')
  @ApiOperation({ summary: '分配线索' })
  assign(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: AssignLeadDto) {
    return this.service.assign(user.teamId, id, dto);
  }

  @Post('leads/auto-assign')
  @ApiOperation({ summary: '自动分配' })
  autoAssign(@CurrentUser() user: { teamId: string }) {
    return this.service.autoAssign(user.teamId);
  }

  @Get('leads/:id/follow-ups')
  @ApiOperation({ summary: '跟进记录' })
  followUps(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.followUps(user.teamId, id);
  }

  @Post('leads/:id/follow-ups')
  @ApiOperation({ summary: '添加跟进' })
  addFollowUp(@CurrentUser() user: { id: string; teamId: string }, @Param('id') id: string, @Body() dto: FollowUpDto) {
    return this.service.addFollowUp(user.teamId, id, user.id, dto);
  }

  @Get('leads/attribution')
  @ApiOperation({ summary: '线索归因分析' })
  attribution(@CurrentUser() user: { teamId: string }) {
    return this.service.attribution(user.teamId);
  }

  @Get('crm')
  @ApiOperation({ summary: 'CRM 对接' })
  crm(@CurrentUser() user: { teamId: string }) {
    return this.service.listCrm(user.teamId);
  }

  @Post('crm')
  @ApiOperation({ summary: '创建 CRM 配置' })
  @Roles('super_admin', 'ops_lead')
  createCrm(@CurrentUser() user: { teamId: string }, @Body() dto: CrmConfigDto) {
    return this.service.createCrmConfig(user.teamId, dto);
  }

  @Patch('crm/:id')
  @ApiOperation({ summary: '更新 CRM 配置' })
  @Roles('super_admin', 'ops_lead')
  updateCrm(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: CrmConfigDto) {
    return this.service.updateCrmConfig(user.teamId, id, dto);
  }

  @Delete('crm/:id')
  @ApiOperation({ summary: '删除 CRM 配置' })
  @Roles('super_admin', 'ops_lead')
  removeCrm(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeCrmConfig(user.teamId, id);
  }

  @Post('leads/:id/sync-crm')
  @ApiOperation({ summary: '手动触发 CRM 同步' })
  syncCrm(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.syncCrm(user.teamId, id);
  }

  @Post('crm/sync')
  @ApiOperation({ summary: '手动同步全部未结束线索到 CRM' })
  @Roles('super_admin', 'ops_lead')
  syncAllCrm(@CurrentUser() user: { teamId: string }) {
    return this.service.syncAllCrm(user.teamId);
  }

  @Post('notification-channels/test')
  @ApiOperation({ summary: '向已配置的企微、短信和邮箱发送测试通知' })
  @Roles('super_admin', 'ops_lead')
  testNotifications(@CurrentUser() user: { teamId: string }) {
    return this.service.testNotifications(user.teamId);
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Webhook 列表' })
  webhooks(@CurrentUser() user: { teamId: string }) {
    return this.service.listWebhooks(user.teamId);
  }

  @Post('webhooks')
  @ApiOperation({ summary: '创建 Webhook' })
  @Roles('super_admin', 'ops_lead')
  createWebhook(@CurrentUser() user: { teamId: string }, @Body() dto: CreateWebhookDto) {
    return this.service.createWebhook(user.teamId, dto);
  }

  @Patch('webhooks/:id')
  @ApiOperation({ summary: '更新 Webhook' })
  @Roles('super_admin', 'ops_lead')
  updateWebhook(@CurrentUser() user: { teamId: string }, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.service.updateWebhook(user.teamId, id, dto);
  }

  @Delete('webhooks/:id')
  @ApiOperation({ summary: '删除 Webhook' })
  @Roles('super_admin', 'ops_lead')
  removeWebhook(@CurrentUser() user: { teamId: string }, @Param('id') id: string) {
    return this.service.removeWebhook(user.teamId, id);
  }

  @Get('leads/export')
  @ApiOperation({ summary: '导出线索 Excel' })
  async exportLeads(@CurrentUser() user: { teamId: string }, @Res() res: Response) {
    const buffer = await this.service.exportLeads(user.teamId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');
    res.send(Buffer.from(buffer));
  }
}
