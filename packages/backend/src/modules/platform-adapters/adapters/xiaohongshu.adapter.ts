import { Injectable } from '@nestjs/common';
import { ConfiguredPlatformAdapter } from '../configured-platform.adapter';

/** 小红书发布只允许走官方审核通过的服务商/企业网关。 */
@Injectable()
export class XiaohongshuAdapter extends ConfiguredPlatformAdapter {}
