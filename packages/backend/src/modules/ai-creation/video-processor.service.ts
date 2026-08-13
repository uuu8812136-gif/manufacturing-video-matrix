import { Injectable, Logger } from '@nestjs/common';
import { MinioService } from '../system/minio.service';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { downloadExternalBuffer } from '../../common/utils/external-url.util';

interface RatioDims {
  w: number;
  h: number;
}

export interface MixcutOptions {
  watermark?: string;
  ratio?: string;
}

@Injectable()
export class VideoProcessorService {
  private readonly logger = new Logger(VideoProcessorService.name);

  constructor(private minio: MinioService) {}

  private ensureFfmpeg(): void {
    if (!ffmpegInstaller?.path || !existsSync(ffmpegInstaller.path)) {
      throw new Error('ffmpeg 不可用');
    }
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }

  private ratioDims(ratio: string): RatioDims {
    switch (ratio) {
      case '16:9':
        return { w: 1920, h: 1080 };
      case '1:1':
        return { w: 1080, h: 1080 };
      case '3:4':
        return { w: 1080, h: 1440 };
      case '9:16':
      default:
        return { w: 1080, h: 1920 };
    }
  }

  private async download(url: string, dest: string): Promise<void> {
    const buffer = await this.minio.downloadSignedPublicUrl(url) || await downloadExternalBuffer(url);
    writeFileSync(dest, buffer);
  }

  private cleanup(files: string[]): void {
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  async mixcut(inputClips: string[], options?: MixcutOptions): Promise<string> {
    this.ensureFfmpeg();
    const tmpFiles: string[] = [];
    try {
      if (!inputClips || inputClips.length === 0) {
        throw new Error('inputClips 为空');
      }
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const downloaded: string[] = [];
      for (let i = 0; i < inputClips.length; i++) {
        const dest = join(tmpdir(), `mixcut_in_${stamp}_${i}.mp4`);
        await this.download(inputClips[i], dest);
        downloaded.push(dest);
        tmpFiles.push(dest);
      }

      const listFile = join(tmpdir(), `mixcut_list_${stamp}.txt`);
      const listContent = downloaded
        .map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      writeFileSync(listFile, listContent);
      tmpFiles.push(listFile);

      let watermarkPath: string | undefined;
      if (options?.watermark) {
        watermarkPath = join(tmpdir(), `mixcut_wm_${stamp}.png`);
        await this.download(options.watermark, watermarkPath);
        tmpFiles.push(watermarkPath);
      }

      const outputPath = join(tmpdir(), `mixcut_out_${stamp}.mp4`);
      tmpFiles.push(outputPath);

      await this.runConcat(listFile, outputPath, options?.ratio, watermarkPath);

      const buffer = readFileSync(outputPath);
      const key = `ai-creation/mixcut/${stamp}.mp4`;
      await this.minio.upload(key, buffer, 'video/mp4');
      return this.minio.publicUrl(key);
    } finally {
      this.cleanup(tmpFiles);
    }
  }

  async adaptRatio(videoUrl: string, ratio: string): Promise<string> {
    this.ensureFfmpeg();
    const tmpFiles: string[] = [];
    try {
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const input = join(tmpdir(), `adapt_in_${stamp}.mp4`);
      await this.download(videoUrl, input);
      tmpFiles.push(input);
      const output = join(tmpdir(), `adapt_out_${stamp}.mp4`);
      tmpFiles.push(output);
      const dims = this.ratioDims(ratio);
      await new Promise<void>((resolve, reject) => {
        ffmpeg(input)
          .videoFilters([
            `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase`,
            `crop=${dims.w}:${dims.h}`,
          ])
          .outputOptions(this.videoAndOptionalAudioMap())
          .save(output)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err));
      });
      const buffer = readFileSync(output);
      const key = `ai-creation/adapt/${stamp}.mp4`;
      await this.minio.upload(key, buffer, 'video/mp4');
      return this.minio.publicUrl(key);
    } finally {
      this.cleanup(tmpFiles);
    }
  }

  async convertToGif(videoUrl: string): Promise<string> {
    return this.processSingle(videoUrl, 'gif', 'gif', (command, output) => {
      command.outputOptions(['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0']).save(output);
    });
  }

  async changeSpeed(videoUrl: string, speed: number): Promise<string> {
    const audioFilters = this.atempoFilters(speed).join(',');
    return this.processSingle(videoUrl, 'speed', 'mp4', (command, output) => {
      command.videoFilters(`setpts=${(1 / speed).toFixed(6)}*PTS`).audioFilters(audioFilters).save(output);
    });
  }

  async cropVideo(videoUrl: string, start: number, duration: number): Promise<string> {
    return this.processSingle(videoUrl, 'crop', 'mp4', (command, output) => {
      command.seekInput(start).duration(duration).videoCodec('libx264').audioCodec('aac').save(output);
    });
  }

  private async processSingle(
    videoUrl: string,
    folder: string,
    extension: 'mp4' | 'gif',
    configure: (command: ffmpeg.FfmpegCommand, output: string) => void,
  ) {
    this.ensureFfmpeg();
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const input = join(tmpdir(), `tool_in_${stamp}.mp4`);
    const output = join(tmpdir(), `tool_out_${stamp}.${extension}`);
    try {
      await this.download(videoUrl, input);
      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(input).on('end', () => resolve()).on('error', (error: Error) => reject(error));
        configure(command, output);
      });
      const key = `ai-creation/${folder}/${stamp}.${extension}`;
      await this.minio.upload(key, readFileSync(output), extension === 'gif' ? 'image/gif' : 'video/mp4');
      return this.minio.publicUrl(key);
    } finally {
      this.cleanup([input, output]);
    }
  }

  private atempoFilters(speed: number) {
    const filters: number[] = [];
    let remaining = speed;
    while (remaining > 2) { filters.push(2); remaining /= 2; }
    while (remaining < 0.5) { filters.push(0.5); remaining /= 0.5; }
    filters.push(Number(remaining.toFixed(4)));
    return filters.map((value) => `atempo=${value}`);
  }

  private runConcat(
    listFile: string,
    output: string,
    ratio?: string,
    watermarkPath?: string,
  ): Promise<void> {
    const dims = ratio ? this.ratioDims(ratio) : undefined;
    return new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg();
      cmd.input(listFile).inputOptions(['-f', 'concat', '-safe', '0']);
      if (watermarkPath) {
        cmd.input(watermarkPath);
        const scaleCrop = dims
          ? `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h}`
          : 'null';
        cmd.complexFilter(
          [
            { filter: scaleCrop, inputs: '0:v', outputs: 'bg' },
            { filter: 'overlay=10:10', inputs: ['bg', '1:v'], outputs: 'v' },
          ],
          'v',
        );
        cmd.outputOptions(['-map', 'v', '-map', '0:a?']);
      } else if (dims) {
        cmd.videoFilters([
          `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase`,
          `crop=${dims.w}:${dims.h}`,
        ]);
        cmd.outputOptions(this.videoAndOptionalAudioMap());
      }
      cmd
        .save(output)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err));
    });
  }

  private videoAndOptionalAudioMap(): string[] {
    return ['-map', '0:v:0', '-map', '0:a?'];
  }
}
