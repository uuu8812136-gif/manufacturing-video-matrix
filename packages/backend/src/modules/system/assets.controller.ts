import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { extname } from 'node:path';
import { MinioService } from './minio.service';
import { CurrentUser, Public } from '../../common/decorators';

const MAX_UPLOAD_SIZE = 250 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

@ApiBearerAuth()
@ApiTags('文件资产')
@Controller('assets')
export class AssetsController {
  constructor(private minio: MinioService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传企业私有素材并返回可供平台拉取的稳定签名 URL' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 } }))
  async upload(
    @CurrentUser() user: { teamId: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择要上传的文件');
    if (!this.isAllowedMime(file.mimetype)) throw new BadRequestException(`不支持的文件类型：${file.mimetype}`);
    const extension = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    const key = `teams/${user.teamId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
    await this.minio.upload(key, file.buffer, file.mimetype || 'application/octet-stream');
    return {
      key,
      name: file.originalname,
      size: file.size,
      contentType: file.mimetype,
      url: this.minio.publicUrl(key),
    };
  }

  @Public()
  @Get('public/:token')
  @ApiOperation({ summary: '平台可访问的签名素材地址' })
  async publicAsset(@Param('token') token: string, @Req() request: Request, @Res() response: Response) {
    const key = this.minio.resolvePublicToken(token);
    const metadata = await this.minio.stat(key);
    response.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const range = request.headers.range;
    if (!range) {
      response.setHeader('Content-Length', String(metadata.size));
      const stream = await this.minio.stream(key);
      stream.pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) {
      response.status(416).setHeader('Content-Range', `bytes */${metadata.size}`);
      response.end();
      return;
    }
    let start: number;
    let end: number;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        response.status(416).setHeader('Content-Range', `bytes */${metadata.size}`);
        response.end();
        return;
      }
      start = Math.max(metadata.size - suffixLength, 0);
      end = metadata.size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : metadata.size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= metadata.size || end < start) {
      response.status(416).setHeader('Content-Range', `bytes */${metadata.size}`);
      response.end();
      return;
    }
    end = Math.min(end, metadata.size - 1);
    const length = end - start + 1;
    response.status(206);
    response.setHeader('Content-Range', `bytes ${start}-${end}/${metadata.size}`);
    response.setHeader('Content-Length', String(length));
    const stream = await this.minio.stream(key, start, length);
    stream.pipe(response);
  }

  private isAllowedMime(mime: string) {
    return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || ALLOWED_MIME_TYPES.has(mime);
  }
}
