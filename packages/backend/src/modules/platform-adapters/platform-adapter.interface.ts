export interface PublishResult {
  success: boolean;
  platformContentId?: string;
  failReason?: string;
}

export interface PlatformStats {
  playCount: number;
  readCount: number;
  // Optional because some platform gateways return other metrics without a
  // follower metric. Absence must not be coerced to a real zero.
  fanCount?: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface PlatformComment {
  externalId?: string;
  platformContentId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: string;
}

export interface PlatformMessage {
  externalId?: string;
  userName: string;
  text: string;
  createdAt: string;
}

export interface PlatformUserInfo {
  user_id?: string;
  name?: string;
  username?: string;
  avatar?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlatformLoginResult {
  valid: boolean;
  transient?: boolean;
  reason?: string;
  userInfo?: PlatformUserInfo;
}

export interface PlatformLoginOptions {
  timeoutMs?: number;
}

export interface IPlatformAdapter {
  platform: string;
  publishVideo(params: {
    accountCredentials: string;
    videoUrl: string;
    title: string;
    coverUrl?: string;
    tags?: string[];
    attachType?: string;
    attachValue?: string;
  }): Promise<PublishResult>;
  publishImageText(params: {
    accountCredentials: string;
    images: string[];
    title: string;
    body: string;
    tags?: string[];
    attachType?: string;
    attachValue?: string;
  }): Promise<PublishResult>;
  fetchStats(accountCredentials: string): Promise<PlatformStats>;
  fetchComments(accountCredentials: string): Promise<PlatformComment[]>;
  fetchMessages(accountCredentials: string): Promise<PlatformMessage[]>;
  replyComment?(params: {
    accountCredentials: string;
    externalId: string;
    platformContentId?: string;
    text: string;
  }): Promise<PublishResult>;
  replyMessage?(params: {
    accountCredentials: string;
    externalId: string;
    text: string;
  }): Promise<PublishResult>;
  checkLogin(accountCredentials: string, options?: PlatformLoginOptions): Promise<PlatformLoginResult>;
}
