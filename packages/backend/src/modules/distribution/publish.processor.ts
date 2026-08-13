import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DistributionService } from './distribution.service';
import { PUBLISH_QUEUE } from './distribution.constants';

@Processor(PUBLISH_QUEUE, {
  concurrency: 10,
  limiter: { max: 100, duration: 60_000 },
})
export class PublishProcessor extends WorkerHost {
  constructor(private readonly distribution: DistributionService) {
    super();
  }

  async process(job: Job<{ taskId: string }>) {
    await this.distribution.processTask(job.data.taskId);
    return { taskId: job.data.taskId };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ taskId: string }> | undefined, error: Error) {
    if (!job) return;
    const maxAttempts = Number(job.opts.attempts || 1);
    if (job.attemptsMade >= maxAttempts) {
      await this.distribution.markTaskFailed(job.data.taskId, error.message);
    }
  }
}
