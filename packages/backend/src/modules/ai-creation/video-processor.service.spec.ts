import { VideoProcessorService } from './video-processor.service';
import { MinioService } from '../system/minio.service';

describe('VideoProcessorService', () => {
  const service = new VideoProcessorService({} as MinioService);

  it.each([
    ['9:16', { w: 1080, h: 1920 }],
    ['16:9', { w: 1920, h: 1080 }],
    ['1:1', { w: 1080, h: 1080 }],
    ['3:4', { w: 1080, h: 1440 }],
  ])('maps %s to the expected output dimensions', (ratio, expected) => {
    const ratioDims = (service as unknown as { ratioDims: (value: string) => { w: number; h: number } }).ratioDims;
    expect(ratioDims.call(service, ratio)).toEqual(expected);
  });

  it('keeps the video stream when optional audio is mapped explicitly', () => {
    const videoAndOptionalAudioMap = (
      service as unknown as { videoAndOptionalAudioMap: () => string[] }
    ).videoAndOptionalAudioMap;

    expect(videoAndOptionalAudioMap.call(service)).toEqual([
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
    ]);
  });
});
