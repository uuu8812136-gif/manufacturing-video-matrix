import { Global, Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module';
import { PlatformAdapterFactory } from './platform-adapter.factory';
import { SocialBrowserClient } from './social-browser.client';

@Global()
@Module({
  imports: [SystemModule],
  providers: [PlatformAdapterFactory, SocialBrowserClient],
  exports: [PlatformAdapterFactory, SocialBrowserClient],
})
export class PlatformAdaptersModule {}
