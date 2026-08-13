import { Injectable } from '@nestjs/common';
import { ConfiguredPlatformAdapter } from '../configured-platform.adapter';

/**
 * 视频号没有面向普通开发者的公开服务端投稿协议。
 * 该类只保留兼容旧引用，真实请求必须走已获授权的平台网关。
 */
@Injectable()
export class VideoAccountAdapter extends ConfiguredPlatformAdapter {}
