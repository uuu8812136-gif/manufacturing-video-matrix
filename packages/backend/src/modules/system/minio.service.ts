import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

export interface StoredObject {
  name: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  contentType?: string;
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client!: MinioClient;
  private bucket: string;
  private readonly endPoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;
  private readonly accessKey: string;
  private readonly secretKey: string;

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT') || 'http://localhost:9000';
    const url = new URL(endpoint);
    this.endPoint = url.hostname;
    this.port = parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10);
    this.useSSL = url.protocol === 'https:';
    this.accessKey = this.config.get<string>('S3_ACCESS_KEY') || 'mvms_minio';
    this.secretKey = this.config.get<string>('S3_SECRET_KEY') || 'mvms_minio_2025';
    this.bucket = this.config.get<string>('S3_BUCKET') || 'mvms-assets';
  }

  async onModuleInit() {
    this.client = new MinioClient({
      endPoint: this.endPoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`创建 bucket: ${this.bucket}`);
      }
    } catch (err) {
      this.logger.warn(`MinIO 未就绪，文件存储将降级: ${(err as Error).message}`);
    }
  }

  async upload(key: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, contentType ? { 'Content-Type': contentType } : undefined);
  }

  async uploadStream(key: string, stream: Readable, size?: number, contentType?: string): Promise<void> {
    await this.client.putObject(
      this.bucket,
      key,
      stream,
      size,
      contentType ? { 'Content-Type': contentType } : undefined,
    );
  }

  async download(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  downloadStream(key: string) {
    return this.client.getObject(this.bucket, key);
  }

  async listObjects(prefix = ''): Promise<StoredObject[]> {
    const result: StoredObject[] = [];
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    for await (const item of stream) {
      if (!item.name) continue;
      const stat = await this.client.statObject(this.bucket, item.name);
      const metadata = stat.metaData || {};
      result.push({
        name: item.name,
        size: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified,
        contentType: metadata['content-type'] || metadata['Content-Type'],
      });
    }
    return result;
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.copyObject(this.bucket, targetKey, `/${this.bucket}/${sourceKey}`);
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async stat(key: string): Promise<{ size: number; contentType?: string }> {
    const stat = await this.client.statObject(this.bucket, key);
    const metadata = stat.metaData || {};
    return {
      size: stat.size,
      contentType: metadata['content-type'] || metadata['Content-Type'],
    };
  }

  stream(key: string, offset?: number, length?: number) {
    if (offset !== undefined && length !== undefined) {
      return this.client.getPartialObject(this.bucket, key, offset, length);
    }
    return this.client.getObject(this.bucket, key);
  }

  publicUrl(key: string) {
    const encodedKey = Buffer.from(key).toString('base64url');
    const base = (this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const prefix = (this.config.get<string>('API_PREFIX') || 'api').replace(/^\/+|\/+$/g, '');
    return `${base}/${prefix}/assets/public/${encodedKey}.${this.sign(encodedKey)}`;
  }

  async downloadSignedPublicUrl(value: string, maxBytes = 512 * 1024 * 1024): Promise<Buffer | null> {
    let input: URL;
    let publicBase: URL;
    try {
      input = new URL(value);
      publicBase = new URL(this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000');
    } catch {
      return null;
    }
    if (input.origin !== publicBase.origin) return null;
    const prefix = (this.config.get<string>('API_PREFIX') || 'api').replace(/^\/+|\/+$/g, '');
    const marker = `${publicBase.pathname.replace(/\/$/, '')}/${prefix}/assets/public/`.replace(/\/+/g, '/');
    if (!input.pathname.startsWith(marker)) return null;
    let token = '';
    try {
      token = decodeURIComponent(input.pathname.slice(marker.length));
    } catch {
      return null;
    }
    if (!token || token.includes('/')) return null;
    const key = this.resolvePublicToken(token);
    const metadata = await this.stat(key);
    if (metadata.size > maxBytes) throw new BadRequestException(`文件超过允许大小 ${Math.round(maxBytes / 1024 / 1024)}MB`);
    return this.download(key);
  }

  resolvePublicToken(token: string) {
    const separator = token.lastIndexOf('.');
    if (separator <= 0) throw new BadRequestException('文件签名无效');
    const encodedKey = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = this.sign(encodedKey);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new BadRequestException('文件签名无效');
    }
    let key = '';
    try {
      key = Buffer.from(encodedKey, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('文件地址无效');
    }
    if (!['teams/', 'ai-creation/', 'digital-human/'].some((prefix) => key.startsWith(prefix))) {
      throw new BadRequestException('文件地址无效');
    }
    return key;
  }

  private sign(value: string) {
    const secret = this.config.get<string>('ASSET_SIGNING_SECRET') || this.config.get<string>('JWT_SECRET') || '';
    if (secret.length < 32) throw new BadRequestException('ASSET_SIGNING_SECRET/JWT_SECRET 至少需要 32 位');
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  async presignedUrl(key: string, expiry = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expiry);
  }
}
