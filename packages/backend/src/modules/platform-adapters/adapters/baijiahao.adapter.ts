import { Injectable } from '@nestjs/common';
import { ConfiguredPlatformAdapter } from '../configured-platform.adapter';

/** 百家号发布只允许走官方审核通过的合作方网关。 */
@Injectable()
export class BaijiahaoAdapter extends ConfiguredPlatformAdapter {}
