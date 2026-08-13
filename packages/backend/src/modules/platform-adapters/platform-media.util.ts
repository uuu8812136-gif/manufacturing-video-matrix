import { BadRequestException } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadExternalBuffer } from '../../common/utils/external-url.util';
import { MinioService } from '../system/minio.service';

export interface PlatformMediaAsset {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface DetectedMedia {
  kind: 'video' | 'image';
  extension: string;
  contentType: string;
}

export async function loadPlatformMedia(
  minio: MinioService,
  rawUrl: string,
  kind: 'video' | 'image',
  maxBytes: number,
): Promise<PlatformMediaAsset> {
  if (!rawUrl || rawUrl.startsWith('mock://')) {
    throw new BadRequestException(`${kind === 'video' ? '视频' : '图片'}地址不可用`);
  }

  const buffer = (await minio.downloadSignedPublicUrl(rawUrl, maxBytes))
    || (await downloadExternalBuffer(rawUrl, maxBytes));
  if (!buffer.length) throw new BadRequestException(`${kind === 'video' ? '视频' : '图片'}文件为空`);
  if (buffer.length > maxBytes) throw new BadRequestException(`文件超过允许大小 ${Math.floor(maxBytes / 1024 / 1024)}MB`);

  const detected = detectMedia(buffer);
  if (!detected) {
    throw new BadRequestException(`无法识别${kind === 'video' ? '视频' : '图片'}文件格式`);
  }
  if (detected.kind !== kind) {
    throw new BadRequestException(`文件内容不是有效的${kind === 'video' ? '视频' : '图片'}`);
  }
  if (kind === 'video') {
    return {
      buffer,
      filename: `video${detected.extension}`,
      contentType: detected.contentType,
    };
  }

  return {
    buffer,
    filename: `cover${detected.extension}`,
    contentType: detected.contentType,
  };
}

/** Convert platform covers to the JPEG format required by Kuaishou. */
export async function ensureJpeg(asset: PlatformMediaAsset, maxBytes: number): Promise<PlatformMediaAsset> {
  if (asset.contentType === 'image/jpeg') return asset;
  if (!asset.contentType.startsWith('image/')) throw new BadRequestException('封面不是有效图片');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const input = join(tmpdir(), `platform-cover-${stamp}${asset.filename.match(/\.[^.]+$/)?.[0] || '.img'}`);
  const output = join(tmpdir(), `platform-cover-${stamp}.jpg`);
  try {
    writeFileSync(input, asset.buffer);
    if (ffmpegInstaller?.path && existsSync(ffmpegInstaller.path)) ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .videoCodec('mjpeg')
        .outputOptions(['-frames:v 1', '-q:v 2'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (error: Error) => reject(error))
        .run();
    });
    const buffer = readFileSync(output);
    if (!buffer.length || buffer.length > maxBytes) {
      throw new BadRequestException(`JPEG 封面超过允许大小 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
    }
    return { buffer, filename: 'cover.jpg', contentType: 'image/jpeg' };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`封面转换为 JPEG 失败：${(error as Error).message}`);
  } finally {
    for (const file of [input, output]) {
      try { unlinkSync(file); } catch { /* 文件可能尚未创建 */ }
    }
  }
}

function detectMedia(buffer: Buffer): DetectedMedia | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', extension: '.jpg', contentType: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', extension: '.png', contentType: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { kind: 'image', extension: '.webp', contentType: 'image/webp' };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: 'video', extension: '.webm', contentType: 'video/webm' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    return brand === 'qt  '
      ? { kind: 'video', extension: '.mov', contentType: 'video/quicktime' }
      : { kind: 'video', extension: '.mp4', contentType: 'video/mp4' };
  }
  return undefined;
}

export function bufferBlob(buffer: Buffer, contentType: string): Blob {
  return new Blob([new Uint8Array(buffer)], { type: contentType });
}
