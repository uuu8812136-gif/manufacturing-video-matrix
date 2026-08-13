import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { DistributionService } from './distribution.service';
import { CreateContentDto, PublishDto, BatchImportDto } from './dto/content.dto';
import { CurrentUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('内容智能分发')
@Controller()
export class DistributionController {
  constructor(private distService: DistributionService) {}

  @Get('contents')
  @ApiOperation({ summary: '内容列表' })
  listContents(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.distService.listContents(user.teamId, query);
  }

  @Get('contents/:id')
  @ApiOperation({ summary: '内容详情' })
  getContent(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.distService.getContent(id, user.teamId);
  }

  @Post('contents')
  @ApiOperation({ summary: '创建内容' })
  createContent(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: CreateContentDto) {
    return this.distService.createContent(user.teamId, user.id, dto);
  }

  @Patch('contents/:id')
  @ApiOperation({ summary: '更新内容' })
  updateContent(
    @Param('id') id: string,
    @CurrentUser() user: { teamId: string },
    @Body() dto: Partial<CreateContentDto>,
  ) {
    return this.distService.updateContent(id, user.teamId, dto);
  }

  @Delete('contents/:id')
  @ApiOperation({ summary: '删除内容' })
  deleteContent(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.distService.deleteContent(id, user.teamId);
  }

  @Post('contents/import-word')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入 Word 文档为图文内容' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  importWord(@CurrentUser() user: { id: string; teamId: string }, @UploadedFile() file?: Express.Multer.File) {
    if (!file || !file.originalname.toLowerCase().endsWith('.docx')) throw new BadRequestException('请上传 .docx Word 文档');
    return this.distService.importWord(user.teamId, user.id, file.buffer, file.originalname);
  }

  @Post('publish')
  @ApiOperation({ summary: '一键/定时发布' })
  publish(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: PublishDto) {
    return this.distService.publish(user.teamId, user.id, dto);
  }

  @Get('publish/tasks')
  @ApiOperation({ summary: '发布任务列表' })
  listTasks(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.distService.listTasks(user.teamId, query);
  }

  @Get('publish/tasks/:id')
  @ApiOperation({ summary: '发布任务详情' })
  getTask(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.distService.getTask(id, user.teamId);
  }

  @Delete('publish/tasks/:id')
  @ApiOperation({ summary: '取消尚未开始的定时发布任务' })
  cancelTask(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.distService.cancelTask(id, user.teamId);
  }

  @Post('publish/batch-import')
  @ApiOperation({ summary: '批量导入发布' })
  batchImport(@CurrentUser() user: { id: string; teamId: string }, @Body() dto: BatchImportDto) {
    return this.distService.batchImport(user.teamId, user.id, dto);
  }
}
