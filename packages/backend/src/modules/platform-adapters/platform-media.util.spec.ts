import { MinioService } from '../system/minio.service';
import { loadPlatformMedia } from './platform-media.util';

describe('platform media type detection', () => {
  it('detects a PNG behind an extensionless signed public URL from its bytes', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('test-payload'),
    ]);
    const minio = {
      downloadSignedPublicUrl: jest.fn().mockResolvedValue(png),
    } as unknown as MinioService;

    await expect(loadPlatformMedia(
      minio,
      'https://api.example.com/api/assets/public/base64.signature',
      'image',
      1024,
    )).resolves.toEqual({ buffer: png, filename: 'cover.png', contentType: 'image/png' });
  });

  it('rejects unknown bytes even when the URL claims a supported extension', async () => {
    const unknown = Buffer.from('<html>not an image</html>');
    const minio = {
      downloadSignedPublicUrl: jest.fn().mockResolvedValue(unknown),
    } as unknown as MinioService;

    await expect(loadPlatformMedia(
      minio,
      'https://api.example.com/cover.jpg',
      'image',
      1024,
    )).rejects.toThrow('无法识别图片文件格式');
  });

  it('rejects unknown video bytes instead of defaulting to MP4', async () => {
    const unknown = Buffer.from('not-a-video');
    const minio = {
      downloadSignedPublicUrl: jest.fn().mockResolvedValue(unknown),
    } as unknown as MinioService;

    await expect(loadPlatformMedia(
      minio,
      'https://api.example.com/video.mp4',
      'video',
      1024,
    )).rejects.toThrow('无法识别视频文件格式');
  });
});
