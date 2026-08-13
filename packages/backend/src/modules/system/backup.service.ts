import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip, createGzip, gunzip, gzip } from 'node:zlib';
import * as tar from 'tar-stream';
import type { Pack } from 'tar-stream';
import type { BackupRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService, StoredObject } from './minio.service';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAX_ARCHIVE_JSON_BYTES = 100 * 1024 * 1024;

const INCREMENTAL_TABLES = [
  { model: 'auditLog', orderField: 'createdAt' },
  { model: 'content', orderField: 'createdAt' },
  { model: 'publishTask', orderField: 'createdAt' },
  { model: 'publishRecord', orderField: 'createdAt' },
  { model: 'lead', orderField: 'createdAt' },
  { model: 'comment', orderField: 'createdAt' },
  { model: 'message', orderField: 'createdAt' },
  { model: 'recreationContent', orderField: 'createdAt' },
  { model: 'hitContent', orderField: 'crawledAt' },
] as const;

interface LoginStateSnapshot {
  version: 1;
  exportedAt: string;
  files: Array<{
    platform: string;
    accountId: string;
    contentBase64: string;
    sha256: string;
    size: number;
  }>;
}

interface BundleObject {
  entry: string;
  key: string;
  size: number;
  etag?: string;
  contentType?: string;
}

interface BundleManifest {
  format: 'mvms-full-backup';
  version: 1;
  createdAt: string;
  database: {
    entry: 'database.sql';
    size: number;
    sha256: string;
  };
  objects: BundleObject[];
  socialBrowser: {
    included: boolean;
    entry?: 'social-browser.json';
    fileCount: number;
    sha256?: string;
  };
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly db: string;
  private readonly dbHost: string;
  private readonly dbPort: string;
  private readonly dbUser: string;
  private readonly dbPass: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private minio: MinioService,
  ) {
    const databaseUrl = new URL(this.config.get<string>('DATABASE_URL') || 'mysql://local:placeholder@localhost:3307/mvms');
    this.db = databaseUrl.pathname.replace(/^\//, '');
    this.dbHost = databaseUrl.hostname;
    this.dbPort = databaseUrl.port || '3306';
    this.dbUser = decodeURIComponent(databaseUrl.username);
    this.dbPass = decodeURIComponent(databaseUrl.password);
  }

  async backupFull(): Promise<{ fileUrl: string; size: number; assets: number; browserSessions: number }> {
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const key = `backups/full-${date}-${randomUUID().slice(0, 8)}.tar.gz`;
    const record = await this.prisma.backupRecord.create({
      data: { type: 'full', fileUrl: key, status: 'running' },
    });
    const directory = await mkdtemp(join(tmpdir(), 'mvms-backup-'));
    const databaseFile = join(directory, 'database.sql');
    this.logger.log(`开始一体化全量备份 -> ${key}`);

    try {
      await this.dumpDatabase(databaseFile);
      const databaseStat = await stat(databaseFile);
      const [databaseHash, objects, socialSnapshot] = await Promise.all([
        this.hashFile(databaseFile),
        this.listApplicationObjects(),
        this.exportSocialBrowserSnapshot(),
      ]);
      const socialBuffer = socialSnapshot
        ? Buffer.from(JSON.stringify(socialSnapshot), 'utf-8')
        : undefined;
      const manifest: BundleManifest = {
        format: 'mvms-full-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        database: {
          entry: 'database.sql',
          size: databaseStat.size,
          sha256: databaseHash,
        },
        objects: objects.map((object) => ({
          entry: this.objectArchiveEntry(object.name),
          key: object.name,
          size: object.size,
          etag: object.etag,
          contentType: object.contentType,
        })),
        socialBrowser: {
          included: Boolean(socialBuffer),
          entry: socialBuffer ? 'social-browser.json' : undefined,
          fileCount: socialSnapshot?.files.length || 0,
          sha256: socialBuffer ? createHash('sha256').update(socialBuffer).digest('hex') : undefined,
        },
      };

      const size = await this.writeBundle(key, manifest, databaseFile, objects, socialBuffer);
      const detail = {
        format: manifest.format,
        version: manifest.version,
        databaseBytes: databaseStat.size,
        assetCount: objects.length,
        assetBytes: objects.reduce((sum, object) => sum + object.size, 0),
        browserSessionCount: manifest.socialBrowser.fileCount,
        browserSessionsIncluded: manifest.socialBrowser.included,
      };
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { size, status: 'success', detail: JSON.stringify(detail) },
      });
      this.logger.log(`一体化全量备份完成 size=${size} assets=${objects.length} sessions=${manifest.socialBrowser.fileCount}`);
      return {
        fileUrl: key,
        size,
        assets: objects.length,
        browserSessions: manifest.socialBrowser.fileCount,
      };
    } catch (error) {
      const message = (error as Error).message.slice(0, 4000);
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'failed', detail: JSON.stringify({ error: message }) },
      }).catch(() => undefined);
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async backupIncremental(): Promise<{ fileUrl: string; size: number }> {
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const key = `backups/incr-${date}-${randomUUID().slice(0, 8)}.json.gz`;
    this.logger.log(`开始增量数据快照 -> ${key}`);
    const record = await this.prisma.backupRecord.create({
      data: {
        type: 'incremental',
        fileUrl: key,
        status: 'running',
        detail: JSON.stringify({ restorable: false, reason: '增量数据快照用于审计与导出，恢复须以一体化全量备份为基线' }),
      },
    });

    try {
      const snapshot: Record<string, unknown> = {
        format: 'mvms-incremental-data-snapshot',
        version: 1,
        exportedAt: new Date().toISOString(),
        restorable: false,
        tables: {},
      };
      for (const { model, orderField } of INCREMENTAL_TABLES) {
        const rows = await (this.prisma as unknown as Record<string, { findMany: (args?: unknown) => Promise<unknown[]> }>)[model].findMany({
          orderBy: { [orderField]: 'desc' },
          take: 5000,
        });
        (snapshot.tables as Record<string, unknown>)[model] = rows;
      }
      const compressed = await gzipAsync(Buffer.from(JSON.stringify(snapshot), 'utf-8'));
      await this.minio.upload(key, compressed, 'application/gzip');
      const size = compressed.length;
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { size, status: 'success' },
      });
      this.logger.log(`增量数据快照完成 size=${size}`);
      return { fileUrl: key, size };
    } catch (error) {
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'failed', detail: JSON.stringify({ error: (error as Error).message.slice(0, 4000), restorable: false }) },
      }).catch(() => undefined);
      throw error;
    }
  }

  async restore(id: string): Promise<{ restored: boolean; assets?: number; browserSessions?: number }> {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record || record.type !== 'full' || record.status !== 'success' || !record.fileUrl) {
      throw new BadRequestException('仅支持恢复状态正常的一体化全量备份');
    }
    if (record.fileUrl.endsWith('.sql.gz')) {
      return this.restoreLegacyDatabase(record.fileUrl);
    }
    if (!record.fileUrl.endsWith('.tar.gz')) {
      throw new BadRequestException('备份格式不支持恢复');
    }
    return this.restoreBundle(record);
  }

  async download(id: string): Promise<{ stream: Readable; filename: string; contentType: string; size: number }> {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record?.fileUrl) throw new BadRequestException('备份记录不存在或文件不可用');
    const [stream, metadata] = await Promise.all([
      this.minio.downloadStream(record.fileUrl),
      this.minio.stat(record.fileUrl),
    ]);
    return {
      stream,
      filename: record.fileUrl.split('/').pop() || 'backup',
      contentType: 'application/gzip',
      size: metadata.size,
    };
  }

  private async listApplicationObjects(): Promise<StoredObject[]> {
    const objects = await this.minio.listObjects();
    return objects.filter((object) => !object.name.startsWith('backups/'));
  }

  private async writeBundle(
    key: string,
    manifest: BundleManifest,
    databaseFile: string,
    objects: StoredObject[],
    socialBuffer?: Buffer,
  ): Promise<number> {
    const pack = tar.pack();
    const compressor = createGzip({ level: 6 });
    let archiveSize = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        archiveSize += chunk.length;
        callback(null, chunk);
      },
    });
    pack.on('error', (error) => meter.destroy(error));
    compressor.on('error', (error) => meter.destroy(error));
    pack.pipe(compressor).pipe(meter);
    const upload = this.minio.uploadStream(key, meter, undefined, 'application/gzip');

    try {
      await this.addBufferEntry(pack, 'manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
      await this.addStreamEntry(
        pack,
        manifest.database.entry,
        createReadStream(databaseFile),
        manifest.database.size,
      );
      for (const object of objects) {
        const source = await this.minio.downloadStream(object.name);
        await this.addStreamEntry(
          pack,
          this.objectArchiveEntry(object.name),
          source,
          object.size,
        );
      }
      if (socialBuffer) {
        await this.addBufferEntry(pack, 'social-browser.json', socialBuffer);
      }
      pack.finalize();
      await upload;
      return archiveSize;
    } catch (error) {
      pack.destroy(error as Error);
      meter.destroy(error as Error);
      await upload.catch(() => undefined);
      throw error;
    }
  }

  private addBufferEntry(pack: Pack, name: string, buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      pack.entry({ name, size: buffer.length, mode: 0o600 }, buffer, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private addStreamEntry(pack: Pack, name: string, source: Readable, size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry = pack.entry({ name, size, mode: 0o600 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
      source.once('error', (error) => {
        entry.destroy(error);
        reject(error);
      });
      source.pipe(entry);
    });
  }

  private objectArchiveEntry(key: string) {
    return `objects/${Buffer.from(key, 'utf-8').toString('base64url')}`;
  }

  private async restoreBundle(record: BackupRecord): Promise<{ restored: boolean; assets: number; browserSessions: number }> {
    const key = record.fileUrl as string;
    const directory = await mkdtemp(join(tmpdir(), 'mvms-restore-'));
    const databaseFile = join(directory, 'database.sql');
    const stagingPrefix = `backups/restore-staging/${randomUUID()}/`;
    const stagedKeys = new Map<string, string>();
    let manifest: BundleManifest | undefined;
    let objectByEntry = new Map<string, BundleObject>();
    let socialSnapshot: LoginStateSnapshot | undefined;
    let databaseFound = false;
    const restoredObjectKeys = new Set<string>();
    const extract = tar.extract();

    extract.on('entry', (header, stream, next) => {
      void (async () => {
        if (header.name === 'manifest.json') {
          const buffer = await this.readLimited(stream, MAX_ARCHIVE_JSON_BYTES);
          const parsed = JSON.parse(buffer.toString('utf-8')) as BundleManifest;
          this.validateManifest(parsed);
          manifest = parsed;
          objectByEntry = new Map(parsed.objects.map((object) => [object.entry, object]));
          return;
        }
        if (!manifest) throw new Error('备份包 manifest 必须位于首个条目');
        if (header.name === manifest.database.entry) {
          if (header.size !== manifest.database.size) throw new Error('数据库备份大小与 manifest 不一致');
          await pipeline(stream, createWriteStream(databaseFile, { mode: 0o600 }));
          databaseFound = true;
          return;
        }
        if (header.name === manifest.socialBrowser.entry) {
          const buffer = await this.readLimited(stream, 60 * 1024 * 1024);
          const hash = createHash('sha256').update(buffer).digest('hex');
          if (hash !== manifest.socialBrowser.sha256) throw new Error('扫码登录态备份完整性校验失败');
          socialSnapshot = JSON.parse(buffer.toString('utf-8')) as LoginStateSnapshot;
          return;
        }
        if (header.name.startsWith('objects/')) {
          const expected = objectByEntry.get(header.name);
          if (!expected || header.size !== expected.size) throw new Error(`素材备份条目不合法：${header.name}`);
          const stagingKey = `${stagingPrefix}${Buffer.from(expected.key, 'utf-8').toString('base64url')}`;
          await this.minio.uploadStream(stagingKey, stream, expected.size, expected.contentType);
          stagedKeys.set(expected.key, stagingKey);
          restoredObjectKeys.add(expected.key);
          return;
        }
        for await (const _chunk of stream) {
          // 消耗目录或未来版本的可忽略条目。
        }
      })().then(() => next()).catch((error) => extract.destroy(error as Error));
    });

    try {
      const source = await this.minio.downloadStream(key);
      await pipeline(source, createGunzip(), extract);
      if (!manifest || !databaseFound) throw new Error('备份包缺少 manifest 或数据库');
      if (restoredObjectKeys.size !== manifest.objects.length) throw new Error('备份包素材条目不完整');
      if (await this.hashFile(databaseFile) !== manifest.database.sha256) {
        throw new Error('数据库备份完整性校验失败');
      }
      if (manifest.socialBrowser.included && !socialSnapshot) {
        throw new Error('备份包缺少扫码登录态');
      }

      for (const object of manifest.objects) {
        const stagingKey = stagedKeys.get(object.key);
        if (!stagingKey) throw new Error(`素材暂存条目缺失：${object.key}`);
        await this.minio.copy(stagingKey, object.key);
      }
      if (socialSnapshot) await this.restoreSocialBrowserSnapshot(socialSnapshot);
      await this.restoreDatabase(databaseFile);
      await this.prisma.backupRecord.upsert({
        where: { id: record.id },
        create: {
          id: record.id,
          type: 'full',
          fileUrl: record.fileUrl,
          size: record.size,
          status: 'success',
          detail: record.detail,
          createdAt: record.createdAt,
        },
        update: {
          fileUrl: record.fileUrl,
          size: record.size,
          status: 'success',
          detail: record.detail,
        },
      });
      this.logger.log(`一体化恢复完成 assets=${manifest.objects.length} sessions=${socialSnapshot?.files.length || 0}`);
      return {
        restored: true,
        assets: manifest.objects.length,
        browserSessions: socialSnapshot?.files.length || 0,
      };
    } finally {
      await Promise.allSettled([...stagedKeys.values()].map((stagingKey) => this.minio.remove(stagingKey)));
      await rm(directory, { recursive: true, force: true });
    }
  }

  private validateManifest(value: BundleManifest) {
    if (value?.format !== 'mvms-full-backup' || value.version !== 1) {
      throw new Error('一体化备份格式不受支持');
    }
    if (!value.database || !Array.isArray(value.objects) || !value.socialBrowser) {
      throw new Error('一体化备份 manifest 不完整');
    }
    const entries = new Set<string>();
    for (const object of value.objects) {
      if (!object.entry?.startsWith('objects/') || !object.key || !Number.isSafeInteger(object.size) || object.size < 0) {
        throw new Error('一体化备份包含非法素材条目');
      }
      if (object.key.startsWith('backups/') || entries.has(object.entry)) {
        throw new Error('一体化备份包含冲突素材条目');
      }
      entries.add(object.entry);
    }
  }

  private async exportSocialBrowserSnapshot(): Promise<LoginStateSnapshot | undefined> {
    if (!this.socialBrowserEnabled()) return undefined;
    const response = await axios.get<LoginStateSnapshot>(`${this.socialBrowserBaseUrl()}/maintenance/backup`, {
      headers: { 'X-Internal-Key': this.socialBrowserKey() },
      timeout: 30_000,
      maxRedirects: 0,
      maxContentLength: 60 * 1024 * 1024,
    });
    return response.data;
  }

  private async restoreSocialBrowserSnapshot(snapshot: LoginStateSnapshot) {
    if (!this.socialBrowserEnabled()) {
      throw new Error('备份包含扫码登录态，但 SOCIAL_BROWSER_ENABLED 未启用，拒绝不完整恢复');
    }
    await axios.post(
      `${this.socialBrowserBaseUrl()}/maintenance/restore`,
      { snapshot, replace: true },
      {
        headers: { 'X-Internal-Key': this.socialBrowserKey(), 'Content-Type': 'application/json' },
        timeout: 30_000,
        maxRedirects: 0,
        maxBodyLength: 60 * 1024 * 1024,
      },
    );
  }

  private socialBrowserEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(
      (this.config.get<string>('SOCIAL_BROWSER_ENABLED') || 'false').toLowerCase(),
    );
  }

  private socialBrowserBaseUrl() {
    const value = (this.config.get<string>('SOCIAL_BROWSER_URL') || 'http://social-browser:8000').replace(/\/$/, '');
    const url = new URL(value);
    const localHosts = new Set(['social-browser', 'localhost', '127.0.0.1', '::1']);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('SOCIAL_BROWSER_URL 必须是无内嵌凭据的 HTTP/HTTPS URL');
    }
    if (url.protocol === 'http:' && !localHosts.has(url.hostname)) {
      throw new Error('HTTP SOCIAL_BROWSER_URL 只能指向本机或 Docker 内部服务');
    }
    return value;
  }

  private socialBrowserKey() {
    const key = this.config.get<string>('SOCIAL_BROWSER_API_KEY')
      || this.config.get<string>('JWT_SECRET')
      || '';
    if (key.length < 32) throw new Error('SOCIAL_BROWSER_API_KEY/JWT_SECRET 至少需要 32 位');
    return key;
  }

  private async dumpDatabase(target: string) {
    await this.runDatabaseCommand('mysqldump', [
      '--host', this.dbHost,
      '--port', this.dbPort,
      '--user', this.dbUser,
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--hex-blob',
      this.db,
    ], createWriteStream(target, { mode: 0o600 }));
  }

  private async restoreDatabase(source: string) {
    const child = spawn('mysql', [
      '--host', this.dbHost,
      '--port', this.dbPort,
      '--user', this.dbUser,
      this.db,
    ], {
      env: { ...process.env, MYSQL_PWD: this.dbPass },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf-8')}`.slice(-16_000);
    });
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mysql restore exited ${code}: ${stderr.trim()}`));
      });
    });
    if (!child.stdin) throw new Error('mysql restore stdin 不可用');
    await Promise.all([pipeline(createReadStream(source), child.stdin), exit]);
  }

  private async runDatabaseCommand(command: string, args: string[], output: Writable) {
    const child = spawn(command, args, {
      env: { ...process.env, MYSQL_PWD: this.dbPass },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf-8')}`.slice(-16_000);
    });
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
      });
    });
    if (!child.stdout) throw new Error(`${command} stdout 不可用`);
    await Promise.all([pipeline(child.stdout, output), exit]);
  }

  private async hashFile(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  }

  private async readLimited(stream: Readable, limit: number) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) throw new Error('备份包 JSON 条目超过大小限制');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  private async restoreLegacyDatabase(key: string): Promise<{ restored: true }> {
    const directory = await mkdtemp(join(tmpdir(), 'mvms-legacy-restore-'));
    const databaseFile = join(directory, 'database.sql');
    try {
      const compressed = await this.minio.download(key);
      await pipeline(
        Readable.from(await gunzipAsync(compressed)),
        createWriteStream(databaseFile, { mode: 0o600 }),
      );
      await this.restoreDatabase(databaseFile);
      return { restored: true };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
