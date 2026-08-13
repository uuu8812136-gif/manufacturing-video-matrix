import client from './client';
import type { GeoCompetitorComparison, GeoRankCheckInfo, GeoTrackingInfo } from '@mvms/shared';

export interface PlatformAccountListItem extends Record<string, unknown> {
  id: string;
  platform: string;
  platformUid?: string | null;
  nickname: string;
  avatar?: string | null;
  authType: string;
  status: string;
  followerCount: number;
  followerCountSyncedAt?: string | null;
  group?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
}

export interface PlatformAccountListResponse {
  list: PlatformAccountListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const assetApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post<{ key: string; name: string; size: number; contentType: string; url: string }>('/assets/upload', form);
  },
};

// ---------- 认证 ----------
export const authApi = {
  register: (data: { phone: string; password: string; name: string; teamName?: string; inviteCode?: string }) =>
    client.post('/auth/register', data),
  login: (data: { phone: string; password: string }) => client.post('/auth/login', data),
  mfaVerify: (data: { mfaToken: string; code: string }) => client.post('/auth/mfa/verify', data),
  mfaSetup: () => client.get('/auth/mfa/setup'),
  mfaEnable: (code: string) => client.post('/auth/mfa/enable', { code }),
  mfaDisable: () => client.post('/auth/mfa/disable'),
  refresh: (refreshToken: string) => client.post('/auth/refresh', { refreshToken }),
  logout: (refreshToken?: string) => client.post('/auth/logout', { refreshToken }),
};

// ---------- 用户 ----------
export const userApi = {
  profile: () => client.get('/users/profile'),
  updateProfile: (data: { name?: string; avatar?: string }) => client.patch('/users/profile', data),
  members: () => client.get('/users/members'),
  invite: (data: { phone: string; name: string; password: string; role: string }) => client.post('/users/members', data),
  updateRole: (id: string, role: string) => client.patch(`/users/members/${id}/role`, { role }),
  removeMember: (id: string) => client.delete(`/users/members/${id}`),
};

// ---------- 账号矩阵 ----------
export const accountApi = {
  list: (params: Record<string, unknown>) => client.get<PlatformAccountListResponse>('/accounts', { params }),
  bind: (data: Record<string, unknown>) => client.post('/accounts', data),
  exchangeOAuth: (data: { platform: string; code: string; state: string; redirectUri: string; nickname: string; groupId?: string; regionId?: string }) => client.post('/accounts/oauth/exchange', data),
  oauthAuthorizeUrl: (platform: string, redirectUri: string) => client.get<{ url: string }>('/accounts/oauth/authorize-url', { params: { platform, redirectUri } }),
  startScan: (data: { platform: string; nickname: string; groupId?: string; regionId?: string; isDealer?: boolean; parentAccountId?: string }) =>
    client.post<{ sessionId: string; platform: string; qrImage: string; expiresIn: number; qrVersion: number; tokenHash?: string; qrHash?: string; generatedAt?: string }>(
      '/accounts/scan/start',
      data,
      // social-browser 启动官方页面的服务端超时为 150 秒。前端必须更长，
      // 否则 Safari/其他浏览器会先中断，而服务端仍留下一个孤立扫码会话。
      { timeout: 180_000 },
    ),
  scanStatus: (sessionId: string) => client.get<{
    status: 'waiting' | 'scanned' | 'security_verification' | 'saving' | 'confirmed' | 'failed' | 'expired';
    message?: string;
    account?: Record<string, unknown>;
    qrImage?: string;
    qrVersion?: number;
    tokenHash?: string;
    qrHash?: string;
    generatedAt?: string;
    expiresIn?: number;
    officialStatus?: string;
    officialErrorCode?: string | number;
    persistencePending?: boolean;
    accountPersistence?: 'updated_existing' | 'created_new';
  }>(`/accounts/scan/${sessionId}/status`, { timeout: 180_000 }),
  cancelScan: (sessionId: string) => client.delete(`/accounts/scan/${sessionId}`),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/accounts/${id}`, data),
  remove: (id: string) => client.delete(`/accounts/${id}`),
  // Browser-mode validation has a bounded 120 s service budget. Keep the UI
  // request alive slightly longer than that instead of discarding a valid
  // final response at the generic 60 s client timeout.
  refresh: (id: string) => client.post(`/accounts/${id}/refresh`, undefined, { timeout: 135_000 }),
  groups: () => client.get('/accounts/groups'),
  createGroup: (data: { name: string; dimension: string }) => client.post('/accounts/groups', data),
  updateGroup: (id: string, data: { name?: string; dimension?: string }) => client.patch(`/accounts/groups/${id}`, data),
  removeGroup: (id: string) => client.delete(`/accounts/groups/${id}`),
  regions: () => client.get('/accounts/regions'),
  createRegion: (data: { name: string; level?: number; parentId?: string }) => client.post('/accounts/regions', data),
  updateRegion: (id: string, data: { name?: string; level?: number; parentId?: string }) => client.patch(`/accounts/regions/${id}`, data),
  removeRegion: (id: string) => client.delete(`/accounts/regions/${id}`),
  dealerDashboard: () => client.get('/accounts/dealer/dashboard'),
  pushdown: (data: { contentId: string; accountIds: Record<string, string[]> }) => client.post('/accounts/dealer/pushdown', data),
};

// ---------- 内容分发 ----------
export const contentApi = {
  list: (params: Record<string, unknown>) => client.get('/contents', { params }),
  get: (id: string) => client.get(`/contents/${id}`),
  create: (data: Record<string, unknown>) => client.post('/contents', data),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/contents/${id}`, data),
  remove: (id: string) => client.delete(`/contents/${id}`),
  importWord: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/contents/import-word', form);
  },
  publish: (data: { contentId: string; accountIds: string[]; scheduledAt?: string }) => client.post('/publish', data),
  tasks: (params: Record<string, unknown>) => client.get('/publish/tasks', { params }),
  task: (id: string) => client.get(`/publish/tasks/${id}`),
  cancelTask: (id: string) => client.delete(`/publish/tasks/${id}`),
  batchImport: (data: { items: { title: string; videoUrl: string; coverUrl?: string; tags?: string[] }[]; accountIds: string[] }) =>
    client.post('/publish/batch-import', data),
};

// ---------- AI 创作 ----------
export const aiApi = {
  templates: () => client.get('/ai-creation/templates'),
  generateScript: (data: Record<string, unknown>) => client.post('/ai-creation/generate-script', data),
  generateTitles: (data: { topic: string; style?: string }) => client.post('/ai-creation/generate-titles', data),
  generateTags: (data: { topic: string }) => client.post('/ai-creation/generate-tags', data),
  sensitiveCheck: (text: string) => client.post('/ai-creation/sensitive-check', { text }),
  materials: (params: Record<string, unknown>) => client.get('/ai-creation/materials', { params }),
  createMaterial: (data: Record<string, unknown>) => client.post('/ai-creation/materials', data),
  removeMaterial: (id: string) => client.delete(`/ai-creation/materials/${id}`),
  extractText: (data: { videoUrl: string }) => client.post('/ai-creation/extract-text', data),
  tts: (data: { text: string; voice?: string; rate?: number; pitch?: number }) => client.post('/ai-creation/synthesize-voice', data),
  mixcut: (data: { clips: string[]; watermark?: string; ratio?: string }) => client.post('/ai-creation/mixcut', data),
  adaptRatio: (data: { videoUrl: string; ratio: string }) => client.post('/ai-creation/adapt-ratio', data),
  videoTool: (data: { videoUrl: string; operation: 'gif' | 'speed' | 'crop'; speed?: number; start?: number; duration?: number }) => client.post('/ai-creation/video-tool', data),
  multiVersions: (data: { topic: string; count?: number; style?: string }) => client.post('/ai-creation/multi-versions', data),
};

// ---------- 产品库 ----------
export const productApi = {
  list: (params: Record<string, unknown>) => client.get('/products', { params }),
  get: (id: string) => client.get(`/products/${id}`),
  create: (data: Record<string, unknown>) => client.post('/products', data),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/products/${id}`, data),
  remove: (id: string) => client.delete(`/products/${id}`),
  import: (products: Record<string, unknown>[]) => client.post('/products/import', { products }),
  importFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/products/import-file', form);
  },
  categories: () => client.get('/products/categories/all'),
  createCategory: (name: string) => client.post('/products/categories', { name }),
  addMaterial: (id: string, data: { name: string; url: string }) => client.post(`/products/${id}/materials`, data),
  removeMaterial: (id: string, materialId: string) => client.delete(`/products/${id}/materials/${materialId}`),
};

// ---------- 爆款二创 ----------
export const hitApi = {
  peers: () => client.get('/hit-recreation/peers'),
  addPeer: (data: Record<string, unknown>) => client.post('/hit-recreation/peers', data),
  updatePeer: (id: string, data: Record<string, unknown>) => client.patch(`/hit-recreation/peers/${id}`, data),
  removePeer: (id: string) => client.delete(`/hit-recreation/peers/${id}`),
  benchmarks: () => client.get('/hit-recreation/benchmarks'),
  crawl: () => client.post('/hit-recreation/crawl'),
  hits: (params: Record<string, unknown>) => client.get('/hit-recreation/hits', { params }),
  hit: (id: string) => client.get(`/hit-recreation/hits/${id}`),
  teardown: (id: string) => client.post(`/hit-recreation/hits/${id}/teardown`),
  generate: (data: { hitContentId: string; productId?: string; style?: string; platform?: string; versionCount?: number }) =>
    client.post('/hit-recreation/recreations/generate', data),
  recreations: (params: Record<string, unknown>) => client.get('/hit-recreation/recreations', { params }),
  recreation: (id: string) => client.get(`/hit-recreation/recreations/${id}`),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/hit-recreation/recreations/${id}`, data),
  remove: (id: string) => client.delete(`/hit-recreation/recreations/${id}`),
  select: (id: string) => client.post(`/hit-recreation/recreations/${id}/select`),
  publish: (id: string, accountIds: string[]) => client.post(`/hit-recreation/recreations/${id}/publish`, { accountIds }),
  score: (id: string, data: { playCount: number; likeCount: number; commentCount: number; shareCount: number }) => client.post(`/hit-recreation/recreations/${id}/score`, data),
  flywheel: () => client.get('/hit-recreation/flywheel/stats'),
};

// ---------- 线索 ----------
export const leadApi = {
  comments: (params: Record<string, unknown>) => client.get('/comments', { params }),
  replyComment: (id: string, text: string) => client.post(`/comments/${id}/reply`, { text }),
  messages: (params: Record<string, unknown>) => client.get('/messages', { params }),
  replyMessage: (id: string, text: string) => client.post(`/messages/${id}/reply`, { text }),
  aiSuggest: (context: string) => client.post('/ai-suggest-reply', { context }),
  syncInteractions: () => client.post('/interactions/sync'),
  autoReply: () => client.get('/auto-reply'),
  createAutoReply: (data: Record<string, unknown>) => client.post('/auto-reply', data),
  updateAutoReply: (id: string, data: Record<string, unknown>) => client.patch(`/auto-reply/${id}`, data),
  removeAutoReply: (id: string) => client.delete(`/auto-reply/${id}`),
  forms: () => client.get('/lead-forms'),
  getForm: (id: string) => client.get(`/lead-forms/${id}`),
  createForm: (data: Record<string, unknown>) => client.post('/lead-forms', data),
  updateForm: (id: string, data: Record<string, unknown>) => client.patch(`/lead-forms/${id}`, data),
  removeForm: (id: string) => client.delete(`/lead-forms/${id}`),
  submitLead: (data: { formId: string; data: Record<string, string>; sourcePlatform?: string; sourceAccountId?: string; sourceContentId?: string; sourceContentTitle?: string }) => client.post('/lead-forms/submit', data),
  list: (params: Record<string, unknown>) => client.get('/leads', { params }),
  update: (id: string, data: Record<string, unknown>) => client.patch(`/leads/${id}`, data),
  assign: (id: string, assigneeId: string) => client.post(`/leads/${id}/assign`, { assigneeId }),
  autoAssign: () => client.post('/leads/auto-assign'),
  followUps: (id: string) => client.get(`/leads/${id}/follow-ups`),
  addFollowUp: (id: string, data: Record<string, unknown>) => client.post(`/leads/${id}/follow-ups`, data),
  attribution: () => client.get('/leads/attribution'),
  export: () => client.get<Blob>('/leads/export', { responseType: 'blob' }),
  listCrm: () => client.get('/crm'),
  createCrmConfig: (data: Record<string, unknown>) => client.post('/crm', data),
  updateCrmConfig: (id: string, data: Record<string, unknown>) => client.patch(`/crm/${id}`, data),
  removeCrmConfig: (id: string) => client.delete(`/crm/${id}`),
  syncCrm: (id: string) => client.post(`/leads/${id}/sync-crm`),
  syncAllCrm: () => client.post('/crm/sync'),
  testNotifications: () => client.post('/notification-channels/test'),
  webhooks: () => client.get('/webhooks'),
  createWebhook: (data: { url: string; events?: string[] }) => client.post('/webhooks', data),
  updateWebhook: (id: string, data: { url?: string; events?: string[]; enabled?: boolean }) => client.patch(`/webhooks/${id}`, data),
  removeWebhook: (id: string) => client.delete(`/webhooks/${id}`),
};

// ---------- 数据中心 ----------
export const dataApi = {
  overview: () => client.get('/data-center/overview'),
  trend: (days?: number) => client.get('/data-center/trend', { params: { days } }),
  ranking: () => client.get('/data-center/account-ranking'),
  employee: () => client.get('/data-center/employee'),
  contentPerformance: () => client.get('/data-center/content-performance'),
  hotTopics: (platform?: string) => client.get('/data-center/hot-topics', { params: { platform } }),
  syncHotTopics: () => client.post('/data-center/hot-topics/sync'),
  export: () => client.get<Blob>('/data-center/export', { responseType: 'blob' }),
};

// ---------- 数字人 ----------
export const dhApi = {
  avatars: () => client.get('/digital-human/avatars'),
  createAvatar: (data: Record<string, unknown>) => client.post('/digital-human/avatars', data),
  updateAvatar: (id: string, data: Record<string, unknown>) => client.patch(`/digital-human/avatars/${id}`, data),
  removeAvatar: (id: string) => client.delete(`/digital-human/avatars/${id}`),
  ips: (params: Record<string, unknown>) => client.get('/digital-human/ips', { params }),
  createIp: (data: Record<string, unknown>) => client.post('/digital-human/ips', data),
  updateIp: (id: string, data: Record<string, unknown>) => client.patch(`/digital-human/ips/${id}`, data),
  removeIp: (id: string) => client.delete(`/digital-human/ips/${id}`),
  generate: (data: { ipId: string; script: string; background?: string }) => client.post('/digital-human/generate', data),
  tasks: (params: Record<string, unknown>) => client.get('/digital-human/tasks', { params }),
  removeTask: (id: string) => client.delete(`/digital-human/tasks/${id}`),
  publishTask: (id: string, data: { accountIds: string[]; scheduledAt?: string }) => client.post(`/digital-human/tasks/${id}/publish`, data),
  strategy: () => client.get('/digital-human/strategy'),
  replaceBackground: (data: { videoUrl: string; bgUrl: string }) => client.post('/digital-human/replace-background', data),
  mixcut: (data: { avatarIds: string[]; script: string }) => client.post('/digital-human/mixcut', data),
};

// ---------- GEO ----------
export const geoApi = {
  keywords: (params: Record<string, unknown>) => client.get('/geo/keywords', { params }),
  createKeyword: (data: { word: string; type: string; targetDomain?: string; targetBrand?: string }) => client.post('/geo/keywords', data),
  capabilities: () => client.get('/geo/capabilities'),
  removeKeyword: (id: string) => client.delete(`/geo/keywords/${id}`),
  check: (id: string) => client.post<{
    checked: number;
    results: GeoRankCheckInfo[];
    unsupported: Array<{ engine: string; reason?: string }>;
  }>(`/geo/keywords/${id}/check`),
  aiCitation: (id: string, aiPlatform: string) => client.post(`/geo/keywords/${id}/ai-citation`, { aiPlatform }),
  tracking: () => client.get<GeoTrackingInfo[]>('/geo/rank-tracking'),
  dualEngine: () => client.get('/geo/dual-engine'),
  competitorCompare: (keyword: string, competitor: string) => client.get<GeoCompetitorComparison>('/geo/competitor-compare', { params: { keyword, competitor } }),
  seoAdvice: (keyword: string) => client.get('/geo/seo-advice', { params: { keyword } }),
  report: () => client.post('/geo/monthly-report'),
};

// ---------- 团队协作 ----------
export const teamApi = {
  reviews: (params: Record<string, unknown>) => client.get('/team-collaboration/reviews', { params }),
  submitReview: (data: { title: string; contentId?: string }) => client.post('/team-collaboration/reviews', data),
  reviewAction: (id: string, data: { action: string; comment?: string }) => client.post(`/team-collaboration/reviews/${id}/action`, data),
  publishReview: (id: string, data: { accountIds: string[]; scheduledAt?: string }) => client.post(`/team-collaboration/reviews/${id}/publish`, data),
  tasks: (params: Record<string, unknown>) => client.get('/team-collaboration/tasks', { params }),
  createTask: (data: Record<string, unknown>) => client.post('/team-collaboration/tasks', data),
  updateTask: (id: string, data: Record<string, unknown>) => client.patch(`/team-collaboration/tasks/${id}`, data),
  performance: () => client.get('/team-collaboration/performance'),
  calendar: (month?: string) => client.get('/team-collaboration/calendar', { params: { month } }),
  createCalendar: (data: Record<string, unknown>) => client.post('/team-collaboration/calendar', data),
  annotations: (contentId: string) => client.get(`/team-collaboration/contents/${contentId}/annotations`),
  createAnnotation: (contentId: string, data: { text: string; position?: Record<string, unknown> }) => client.post(`/team-collaboration/contents/${contentId}/annotations`, data),
};

// ---------- 渠道 ----------
export const channelApi = {
  list: (params: Record<string, unknown>) => client.get('/channels', { params }),
  create: (data: Record<string, unknown>) => client.post('/channels', data),
  codes: (channelId?: string) => client.get('/channels/codes', { params: { channelId } }),
  createCode: (data: { channelId: string; discountRate?: number }) => client.post('/channels/codes', data),
  report: (channelId?: string) => client.get('/channels/report', { params: { channelId } }),
  customers: () => client.get('/channels/customers'),
  markPaid: (id: string, amount: number) => client.post(`/channels/customers/${id}/paid`, { amount }),
  settle: (id: string, settled: boolean) => client.post(`/channels/customers/${id}/settle`, { settled }),
};

// ---------- 系统 ----------
export const systemApi = {
  logs: (params: Record<string, unknown>) => client.get('/system/audit-logs', { params }),
  notifications: () => client.get('/system/notifications'),
  markRead: (id: string) => client.post(`/system/notifications/${id}/read`),
  backups: () => client.get('/system/backups'),
  createBackup: (type: 'full' | 'incremental') => client.post('/system/backups', { type }, { timeout: 0 }),
  restoreBackup: (id: string) => client.post(`/system/backups/${id}/restore`, undefined, { timeout: 0 }),
  downloadBackup: (id: string) => client.get<Blob>(`/system/backups/${id}/download`, { responseType: 'blob', timeout: 0 }),
  integrationReadiness: (probe = false) => client.get('/health/integrations', { params: { probe } }),
};
