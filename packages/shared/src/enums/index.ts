export enum Platform {
  DOUYIN = 'douyin',
  VIDEO_ACCOUNT = 'video_account',
  KUAISHOU = 'kuaishou',
  XIAOHONGSHU = 'xiaohongshu',
  BILIBILI = 'bilibili',
  BAIJIAHAO = 'baijiahao',
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  [Platform.DOUYIN]: '抖音',
  [Platform.VIDEO_ACCOUNT]: '微信视频号',
  [Platform.KUAISHOU]: '快手',
  [Platform.XIAOHONGSHU]: '小红书',
  [Platform.BILIBILI]: '哔哩哔哩',
  [Platform.BAIJIAHAO]: '百家号',
};

export const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
  value: value as Platform,
  label,
}));

export enum Role {
  SUPER_ADMIN = 'super_admin',
  OPS_LEAD = 'ops_lead',
  DEALER = 'dealer',
  CONTENT_EDITOR = 'content_editor',
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: '超级管理员',
  [Role.OPS_LEAD]: '运营主管',
  [Role.DEALER]: '经销商',
  [Role.CONTENT_EDITOR]: '内容编辑',
};

export enum Priority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
}

export enum ContentType {
  VIDEO = 'video',
  IMAGE_TEXT = 'image_text',
  DYNAMIC = 'dynamic',
}

export enum PublishStatus {
  DRAFT = 'draft',
  QUEUED = 'queued',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
}

export enum AccountStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  LIMITED = 'limited',
  BANNED = 'banned',
}

export enum AuthType {
  SCAN = 'scan',
  COOKIE = 'cookie',
  OAUTH = 'oauth',
}

export enum LeadStatus {
  NEW = 'new',
  ASSIGNED = 'assigned',
  FOLLOWING = 'following',
  INTENDED = 'intended',
  DEAL = 'deal',
  LOST = 'lost',
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: '新线索',
  [LeadStatus.ASSIGNED]: '已分配',
  [LeadStatus.FOLLOWING]: '跟进中',
  [LeadStatus.INTENDED]: '高意向',
  [LeadStatus.DEAL]: '已成交',
  [LeadStatus.LOST]: '已流失',
};

export enum LeadIntention {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SCHEDULED = 'scheduled',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export enum RecreationStyle {
  PROFESSIONAL = 'professional',
  HUMOROUS = 'humorous',
  STORY = 'story',
  COMPARE = 'compare',
}

export const RECREATION_STYLE_LABELS: Record<RecreationStyle, string> = {
  [RecreationStyle.PROFESSIONAL]: '专业严肃',
  [RecreationStyle.HUMOROUS]: '轻松幽默',
  [RecreationStyle.STORY]: '故事化',
  [RecreationStyle.COMPARE]: '对比评测',
};

export enum VideoRatio {
  R_9_16 = '9:16',
  R_16_9 = '16:9',
  R_1_1 = '1:1',
  R_3_4 = '3:4',
}

export enum DigitalHumanProvider {
  MOCK = 'mock',
  HEYGEN = 'heygen',
  GUIJI = 'guiji',
  ZHIYING = 'zhiying',
}

export enum ChannelType {
  INDUSTRIAL_PARK = 'industrial_park',
  ASSOCIATION = 'association',
}

export enum TeardownDimension {
  STRUCTURE = 'structure',
  SCRIPT = 'script',
  EMOTION = 'emotion',
  TAG = 'tag',
  MUSIC = 'music',
  VISUAL = 'visual',
  DURATION = 'duration',
}

export enum SubscriptionPlan {
  FREE = 'free',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
  GROUP = 'group',
}

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  [SubscriptionPlan.FREE]: '免费版',
  [SubscriptionPlan.PROFESSIONAL]: '专业版',
  [SubscriptionPlan.ENTERPRISE]: '企业版',
  [SubscriptionPlan.GROUP]: '集团版',
};
