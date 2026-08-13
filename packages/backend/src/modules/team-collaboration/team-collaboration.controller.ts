import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamCollaborationService } from './team-collaboration.service';
import { CreateAnnotationDto, CreateReviewDto, ReviewActionDto, CreateTaskDto, UpdateTaskDto, CreateCalendarDto, PublishReviewDto } from './dto/team.dto';
import { CurrentUser, Roles } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('团队协作')
@Controller('team-collaboration')
export class TeamCollaborationController {
  constructor(private service: TeamCollaborationService) {}

  @Get('reviews')
  @ApiOperation({ summary: '审核列表' })
  reviews(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listReviews(user.teamId, query);
  }

  @Post('reviews')
  @ApiOperation({ summary: '提交审核' })
  submit(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: CreateReviewDto) {
    return this.service.submitReview(user.teamId, user.id, dto);
  }

  @Post('reviews/:id/action')
  @ApiOperation({ summary: '审核操作' })
  @Roles('super_admin', 'ops_lead')
  action(@CurrentUser() user: { id: string; teamId: string }, @Param('id') id: string, @Body() dto: ReviewActionDto) {
    return this.service.reviewAction(user.teamId, id, user.id, dto);
  }

  @Post('reviews/:id/publish')
  @ApiOperation({ summary: '发布已通过审核的内容' })
  @Roles('super_admin', 'ops_lead')
  publishReview(@CurrentUser() user: { id: string; teamId: string }, @Param('id') id: string, @Body() dto: PublishReviewDto) {
    return this.service.publishReview(user.teamId, user.id, id, dto);
  }

  @Get('tasks')
  @ApiOperation({ summary: '任务列表' })
  tasks(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.listTasks(user.teamId, query);
  }

  @Post('tasks')
  @ApiOperation({ summary: '创建任务' })
  @Roles('super_admin', 'ops_lead')
  createTask(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: CreateTaskDto) {
    return this.service.createTask(user.teamId, user.id, dto);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: '更新任务' })
  updateTask(@CurrentUser() user: { id: string; teamId: string; role: string }, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.service.updateTask(user.teamId, user.id, user.role, id, dto);
  }

  @Get('performance')
  @ApiOperation({ summary: '绩效统计' })
  @Roles('super_admin', 'ops_lead')
  performance(@CurrentUser() user: { teamId: string }) {
    return this.service.performance(user.teamId);
  }

  @Get('calendar')
  @ApiOperation({ summary: '内容日历' })
  calendar(@CurrentUser() user: { teamId: string }, @Query('month') month?: string) {
    return this.service.calendar(user.teamId, month);
  }

  @Post('calendar')
  @ApiOperation({ summary: '创建日历事件' })
  createCalendar(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: CreateCalendarDto) {
    return this.service.createCalendar(user.teamId, user.id, dto);
  }

  @Get('contents/:contentId/annotations')
  @ApiOperation({ summary: '内容批注列表' })
  annotations(@CurrentUser() user: { teamId: string }, @Param('contentId') contentId: string) {
    return this.service.annotations(user.teamId, contentId);
  }

  @Post('contents/:contentId/annotations')
  @ApiOperation({ summary: '添加内容批注' })
  createAnnotation(@CurrentUser() user: { id: string; teamId: string }, @Param('contentId') contentId: string, @Body() dto: CreateAnnotationDto) {
    return this.service.createAnnotation(user.teamId, user.id, contentId, dto);
  }
}
