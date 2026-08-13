export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  [key: string]: unknown;
}

export interface UserInfo {
  id: string;
  phone: string;
  name: string;
  avatar?: string | null;
  role: string;
  teamId: string;
  teamName?: string;
  mfaEnabled: boolean;
}

export interface PlatformAccountInfo {
  id: string;
  platform: string;
  nickname: string;
  avatar?: string | null;
  authType: string;
  status: string;
  groupId?: string | null;
  groupName?: string | null;
  followerCount: number;
  regionId?: string | null;
  isDealer?: boolean;
  parentAccountId?: string | null;
  expiredAt?: string | null;
  createdAt: string;
}

export interface ContentInfo {
  id: string;
  type: string;
  title: string;
  coverUrl?: string | null;
  videoUrl?: string | null;
  body?: string | null;
  tags: string[];
  status: string;
  createdAt: string;
}

export interface PublishTaskInfo {
  id: string;
  contentId: string;
  contentTitle: string;
  accountIds: string[];
  platforms: string[];
  scheduledAt?: string | null;
  status: string;
  records?: PublishRecordInfo[];
  createdAt: string;
}

export interface PublishRecordInfo {
  id: string;
  taskId: string;
  accountId: string;
  accountNickname: string;
  platform: string;
  status: string;
  platformContentId?: string | null;
  failReason?: string | null;
  publishedAt?: string | null;
}

export interface LeadInfo {
  id: string;
  name: string;
  phone: string;
  company?: string | null;
  demand?: string | null;
  sourcePlatform: string;
  sourceContentTitle?: string | null;
  sourceAccountNickname?: string | null;
  intention: string;
  status: string;
  assigneeName?: string | null;
  formId?: string | null;
  createdAt: string;
}

export interface HitContentInfo {
  id: string;
  platform: string;
  author: string;
  authorAvatar?: string | null;
  title: string;
  coverUrl?: string | null;
  videoUrl?: string | null;
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
  publishedAt: string;
  crawledAt: string;
  isExplosive: boolean;
  teardown?: HitTeardownInfo | null;
}

export interface HitTeardownInfo {
  id: string;
  hitContentId: string;
  structure: TeardownStructure;
  script: TeardownScript;
  emotionCurve: { phase: string; emotion: string }[];
  tags: string[];
  music: string;
  visual: string;
  duration: string;
  report: string;
}

export interface TeardownStructure {
  hook: string;
  body: string;
  cta: string;
}

export interface TeardownScript {
  framework: string;
  keywords: string[];
  expressions: string[];
}

export interface RecreationContentInfo {
  id: string;
  hitContentId: string;
  hitTitle: string;
  version: string;
  platform: string;
  style: string;
  title: string;
  body: string;
  storyboard?: string | null;
  voiceScript?: string | null;
  altTitles: string[];
  originalityScore: number;
  status: string;
  createdAt: string;
}

export interface ProductInfo {
  id: string;
  name: string;
  category?: string | null;
  parameters: Record<string, string>;
  sellingPoints: string[];
  scenarios: string[];
  materials: { name: string; url: string }[];
  createdAt: string;
}

export interface DataSnapshotInfo {
  accountId: string;
  accountNickname: string;
  platform: string;
  date: string;
  playCount: number;
  readCount: number;
  fanCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface GeoKeywordInfo {
  id: string;
  word: string;
  type: string;
  targetDomain?: string | null;
  targetBrand?: string | null;
  searchEngineRank?: number | null;
  aiCitationRate?: number | null;
  status: string;
}

export type GeoRankMatchedBy = 'domain' | 'brand' | 'both';

export interface GeoRankMatchInfo {
  found: boolean;
  checkedDepth: number;
  matchedUrl: string | null;
  matchedBy: GeoRankMatchedBy | null;
}

export interface GeoRankCheckInfo extends GeoRankMatchInfo {
  engine: string;
  rank: number | null;
}

export interface GeoTrackingInfo {
  keyword: string;
  type: string;
  avgRank: number | null;
  citationEvidenceScore: number | null;
  /** @deprecated Use citationEvidenceScore. */
  citationRate: number | null;
  status: 'good' | 'normal' | 'poor' | 'unchecked';
}

export interface GeoCompetitorComparison {
  keyword: string;
  competitor: string;
  selfRank: number | null;
  competitorRank: number | null;
  comparison: 'self_ahead' | 'competitor_ahead' | 'tie' | 'incomplete';
  advantage: boolean | null;
  gap: number | null;
  selfMatch: GeoRankMatchInfo;
  competitorMatch: GeoRankMatchInfo;
}

export interface DigitalHumanIpInfo {
  id: string;
  name: string;
  avatar: string;
  provider: string;
  voice: string;
  videoCount: number;
  totalPlay: number;
  status: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  contactName: string;
  contactPhone: string;
  customerCount: number;
  paidCount: number;
  totalCommission: number;
  status: string;
}
