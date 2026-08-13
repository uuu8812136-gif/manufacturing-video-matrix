import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO } from './helpers';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; teamId: string };
}

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: HttpMethod,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
  });
  const raw = await response.text();
  expect(response.ok(), `${method} ${path} -> ${response.status()} ${raw}`).toBeTruthy();
  const body = JSON.parse(raw) as ApiEnvelope<T>;
  expect(body.code, `${method} ${path}: ${body.message}`).toBe(0);
  return body.data;
}

async function login(request: APIRequestContext): Promise<AuthSession> {
  return api<AuthSession>(request, '', 'POST', '/api/auth/login', DEMO);
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe('P1 API 功能闭环 @core @api', () => {
  test('认证、资料、成员邀请与角色更新', async ({ request }) => {
    const session = await login(request);
    const token = session.accessToken;
    const profile = await api<{ id: string; name: string }>(request, token, 'GET', '/api/users/profile');

    const changedName = `E2E管理员-${stamp()}`;
    try {
      const updated = await api<{ name: string }>(request, token, 'PATCH', '/api/users/profile', { name: changedName });
      expect(updated.name).toBe(changedName);
    } finally {
      await api(request, token, 'PATCH', '/api/users/profile', { name: profile.name });
    }

    const suffix = String(Date.now()).slice(-8);
    const member = await api<{ id: string; role: string }>(request, token, 'POST', '/api/users/members', {
      phone: `139${suffix}`,
      name: `E2E成员-${suffix}`,
      password: 'e2e-pass-123',
      role: 'content_editor',
    });
    const roleUpdated = await api<{ role: string }>(request, token, 'PATCH', `/api/users/members/${member.id}/role`, {
      role: 'dealer',
    });
    expect(roleUpdated.role).toBe('dealer');

    const refreshed = await api<AuthSession>(request, '', 'POST', '/api/auth/refresh', {
      refreshToken: session.refreshToken,
    });
    expect(refreshed.accessToken).toBeTruthy();
    await api(request, refreshed.accessToken, 'POST', '/api/auth/logout', { refreshToken: refreshed.refreshToken });
  });

  test('账号分组、区域、绑定、刷新、更新与删除', async ({ request }) => {
    const { accessToken } = await login(request);
    const id = stamp();
    const group = await api<{ id: string }>(request, accessToken, 'POST', '/api/accounts/groups', {
      name: `E2E分组-${id}`,
      dimension: 'region',
    });
    const region = await api<{ id: string }>(request, accessToken, 'POST', '/api/accounts/regions', {
      name: `E2E区域-${id}`,
      level: 1,
    });
    const account = await api<{ id: string; nickname: string }>(request, accessToken, 'POST', '/api/accounts', {
      platform: 'douyin',
      nickname: `E2E账号-${id}`,
      authType: 'cookie',
      credentials: `mock:e2e:${id}`,
      groupId: group.id,
      regionId: region.id,
      isDealer: true,
    });
    try {
      const refreshed = await api<{ status: string }>(request, accessToken, 'POST', `/api/accounts/${account.id}/refresh`);
      expect(refreshed.status).toBe('active');
      const updated = await api<{ nickname: string }>(request, accessToken, 'PATCH', `/api/accounts/${account.id}`, {
        nickname: `${account.nickname}-已更新`,
      });
      expect(updated.nickname).toContain('已更新');
      const dealers = await api<unknown[]>(request, accessToken, 'GET', '/api/accounts/dealer/dashboard');
      expect(Array.isArray(dealers)).toBeTruthy();
    } finally {
      await api(request, accessToken, 'DELETE', `/api/accounts/${account.id}`);
    }
  });

  test('内容 CRUD、定时发布、任务详情与批量导入', async ({ request }) => {
    const { accessToken } = await login(request);
    const account = await api<{ id: string }>(request, accessToken, 'POST', '/api/accounts', {
      platform: 'douyin',
      nickname: `E2E发布账号-${stamp()}`,
      authType: 'cookie',
      credentials: `mock:publish:${stamp()}`,
    });
    const accountId = account.id;

    const disposable = await api<{ id: string }>(request, accessToken, 'POST', '/api/contents', {
      type: 'image_text',
      title: `E2E临时内容-${stamp()}`,
      body: '用于验证内容创建、详情、更新和删除。',
      tags: ['e2e', 'crud'],
    });
    const detail = await api<{ id: string }>(request, accessToken, 'GET', `/api/contents/${disposable.id}`);
    expect(detail.id).toBe(disposable.id);
    await api(request, accessToken, 'PATCH', `/api/contents/${disposable.id}`, { title: `E2E已更新-${stamp()}` });
    await api(request, accessToken, 'DELETE', `/api/contents/${disposable.id}`);

    const publishable = await api<{ id: string }>(request, accessToken, 'POST', '/api/contents', {
      type: 'video',
      title: `E2E定时发布-${stamp()}`,
      videoUrl: 'mock://video/e2e.mp4',
      tags: ['e2e'],
    });
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const task = await api<{ id: string; status: string }>(request, accessToken, 'POST', '/api/publish', {
      contentId: publishable.id,
      accountIds: [accountId],
      scheduledAt,
    });
    expect(task.status).toBe('scheduled');
    const taskDetail = await api<{ id: string; records: unknown[] }>(request, accessToken, 'GET', `/api/publish/tasks/${task.id}`);
    expect(taskDetail.id).toBe(task.id);
    expect(taskDetail.records).toHaveLength(1);

    const imported = await api<{ count: number }>(request, accessToken, 'POST', '/api/publish/batch-import', {
      items: [{ title: `E2E批量发布-${stamp()}`, videoUrl: 'mock://video/batch.mp4', tags: ['e2e'] }],
      accountIds: [accountId],
    });
    expect(imported.count).toBe(1);
  });

  test('产品分类、产品 CRUD 与批量导入', async ({ request }) => {
    const { accessToken } = await login(request);
    const id = stamp();
    const category = await api<{ id: string }>(request, accessToken, 'POST', '/api/products/categories', {
      name: `E2E分类-${id}`,
    });
    const product = await api<{ id: string }>(request, accessToken, 'POST', '/api/products', {
      name: `E2E产品-${id}`,
      categoryId: category.id,
      parameters: { power: '10kW' },
      sellingPoints: ['稳定', '节能'],
      scenarios: ['工厂'],
      brandScript: 'E2E 品牌话术',
    });
    try {
      const detail = await api<{ parameters: Record<string, string> }>(request, accessToken, 'GET', `/api/products/${product.id}`);
      expect(detail.parameters.power).toBe('10kW');
      await api(request, accessToken, 'PATCH', `/api/products/${product.id}`, {
        name: `E2E产品已更新-${id}`,
        categoryId: category.id,
        sellingPoints: ['已更新'],
      });
    } finally {
      await api(request, accessToken, 'DELETE', `/api/products/${product.id}`);
    }

    const importedName = `E2E导入产品-${id}`;
    const imported = await api<{ count: number }>(request, accessToken, 'POST', '/api/products/import', {
      products: [{ name: importedName, categoryId: category.id, parameters: { model: 'E2E' } }],
    });
    expect(imported.count).toBe(1);
    const found = await api<{ list: { id: string }[] }>(request, accessToken, 'GET', `/api/products?keyword=${encodeURIComponent(importedName)}`);
    expect(found.list).toHaveLength(1);
    await api(request, accessToken, 'DELETE', `/api/products/${found.list[0].id}`);
  });

  test('AI 脚本、标题、标签、素材、提取、语音与视频工具链', async ({ request }) => {
    const { accessToken } = await login(request);
    const templates = await api<unknown[]>(request, accessToken, 'GET', '/api/ai-creation/templates');
    expect(templates.length).toBeGreaterThan(0);
    const script = await api<{ content: string }>(request, accessToken, 'POST', '/api/ai-creation/generate-script', {
      templateType: 'product_intro',
      topic: 'E2E 工业设备',
    });
    expect(script.content).toBeTruthy();
    const titles = await api<{ titles: string[] }>(request, accessToken, 'POST', '/api/ai-creation/generate-titles', {
      topic: 'E2E 工业设备',
    });
    expect(titles.titles.length).toBeGreaterThan(0);
    const tags = await api<{ tags: string[] }>(request, accessToken, 'POST', '/api/ai-creation/generate-tags', {
      topic: 'E2E 工业设备',
    });
    expect(tags.tags.length).toBeGreaterThan(0);
    await api(request, accessToken, 'POST', '/api/ai-creation/sensitive-check', { text: 'E2E 合规文案' });
    await api(request, accessToken, 'POST', '/api/ai-creation/materials', {
      name: `E2E素材-${stamp()}`,
      type: 'video',
      category: 'test',
      url: 'mock://material/e2e.mp4',
    });
    const materials = await api<{ total: number }>(request, accessToken, 'GET', '/api/ai-creation/materials?category=test');
    expect(materials.total).toBeGreaterThan(0);
    const extracted = await api<{ text: string }>(request, accessToken, 'POST', '/api/ai-creation/extract-text', {
      videoUrl: 'mock://video/e2e.mp4',
    });
    expect(extracted.text).toBeTruthy();
    const voice = await api<{ url: string }>(request, accessToken, 'POST', '/api/ai-creation/synthesize-voice', {
      text: 'E2E 语音合成测试',
      voice: 'default',
      rate: 1,
    });
    expect(voice.url).toBeTruthy();
    const mixcut = await api<{ url: string }>(request, accessToken, 'POST', '/api/ai-creation/mixcut', {
      clips: ['mock://video/a.mp4', 'mock://video/b.mp4'],
      ratio: '9:16',
    });
    expect(mixcut.url).toBeTruthy();
    const adapted = await api<{ url: string }>(request, accessToken, 'POST', '/api/ai-creation/adapt-ratio', {
      videoUrl: 'mock://video/e2e.mp4',
      ratio: '1:1',
    });
    expect(adapted.url).toBeTruthy();
    const versions = await api<{ versions: string[] }>(request, accessToken, 'POST', '/api/ai-creation/multi-versions', {
      topic: 'E2E 多版本脚本',
      count: 2,
    });
    expect(versions.versions).toHaveLength(2);
  });

  test('留资、分配、跟进、归因、自动回复、CRM 与 Webhook', async ({ request }) => {
    const session = await login(request);
    const token = session.accessToken;
    const id = stamp();
    const form = await api<{ id: string; shareUrl: string }>(request, token, 'POST', '/api/lead-forms', {
      name: `E2E留资表单-${id}`,
      fields: [
        { name: 'name', label: '姓名', type: 'text', required: true },
        { name: 'phone', label: '电话', type: 'text', required: true },
      ],
      template: 'consult',
    });
    expect(form.shareUrl).toContain(form.id);
    const lead = await api<{ id: string; status: string }>(request, '', 'POST', '/api/lead-forms/submit', {
      formId: form.id,
      data: { name: `E2E客户-${id}`, phone: `137${String(Date.now()).slice(-8)}`, company: 'E2E公司' },
    });
    expect(lead.status).toBe('new');
    await api(request, token, 'PATCH', `/api/leads/${lead.id}`, {
      intention: 'high',
      tags: ['e2e', '重点'],
    });
    const assigned = await api<{ status: string }>(request, token, 'POST', `/api/leads/${lead.id}/assign`, {
      assigneeId: session.user.id,
    });
    expect(assigned.status).toBe('assigned');
    await api(request, token, 'POST', `/api/leads/${lead.id}/follow-ups`, {
      content: 'E2E 首次跟进',
      result: 'following',
    });
    const followUps = await api<unknown[]>(request, token, 'GET', `/api/leads/${lead.id}/follow-ups`);
    expect(followUps.length).toBeGreaterThan(0);
    const attribution = await api<{ total: number }>(request, token, 'GET', '/api/leads/attribution');
    expect(attribution.total).toBeGreaterThan(0);
    await api(request, token, 'POST', '/api/auto-reply', { keyword: `E2E-${id}`, reply: '已收到', scope: 'all' });
    const suggestion = await api<{ reply: string }>(request, token, 'POST', '/api/ai-suggest-reply', {
      context: '客户询问产品参数',
    });
    expect(suggestion.reply).toBeTruthy();
    const crm = await api<{ id: string }>(request, token, 'POST', '/api/crm', {
      provider: 'fenxi',
      config: { apiUrl: 'https://example.com/crm', token: `mock-token-${id}` },
      enabled: false,
    });
    await api(request, token, 'PATCH', `/api/crm/${crm.id}`, {
      provider: 'fenxi',
      config: { apiUrl: 'https://example.com/crm-updated', token: `mock-token-updated-${id}` },
      enabled: false,
    });
    const sync = await api<{ synced: boolean }>(request, token, 'POST', `/api/leads/${lead.id}/sync-crm`);
    expect(sync.synced).toBe(false);
    await api(request, token, 'POST', '/api/webhooks', {
      url: 'https://example.com/e2e-webhook',
      events: ['lead.updated'],
    });
  });

  test('数字人形象、IP、视频生成、任务、策略与混剪', async ({ request }) => {
    const { accessToken } = await login(request);
    const id = stamp();
    const avatar = await api<{ id: string }>(request, accessToken, 'POST', '/api/digital-human/avatars', {
      name: `E2E形象-${id}`,
      provider: 'heygen',
      avatarKey: `avatar-${id}`,
      voiceKey: `voice-${id}`,
      custom: true,
    });
    const ip = await api<{ id: string }>(request, accessToken, 'POST', '/api/digital-human/ips', {
      name: `E2E-IP-${id}`,
      provider: 'heygen',
      avatarId: avatar.id,
      persona: '专业制造业讲解员',
    });
    const generated = await api<{ id: string; status: string; videoUrl: string }>(request, accessToken, 'POST', '/api/digital-human/generate', {
      ipId: ip.id,
      script: 'E2E 数字人视频生成脚本',
      background: '工厂车间',
    });
    expect(generated.status).toBe('done');
    expect(generated.videoUrl).toBeTruthy();
    const tasks = await api<{ list: { id: string }[] }>(request, accessToken, 'GET', '/api/digital-human/tasks');
    expect(tasks.list.some((item) => item.id === generated.id)).toBeTruthy();
    const strategy = await api<{ advice: string }>(request, accessToken, 'GET', '/api/digital-human/strategy');
    expect(strategy.advice).toBeTruthy();
    const replaced = await api<{ videoUrl: string }>(request, accessToken, 'POST', '/api/digital-human/replace-background', {
      videoUrl: generated.videoUrl,
      bgUrl: 'mock://image/background.jpg',
    });
    expect(replaced.videoUrl).toBeTruthy();
    const mixed = await api<{ videoUrl: string }>(request, accessToken, 'POST', '/api/digital-human/mixcut', {
      avatarIds: [ip.id],
      script: 'E2E 数字人混剪脚本',
    });
    expect(mixed.videoUrl).toBeTruthy();
  });

  test('GEO 关键词、排名、AI 引用、双引擎与月报', async ({ request }) => {
    const { accessToken } = await login(request);
    const keyword = await api<{ id: string; word: string }>(request, accessToken, 'POST', '/api/geo/keywords', {
      word: `E2E工业关键词-${stamp()}`,
      type: 'industry',
      targetBrand: `E2E工业品牌-${stamp()}`,
    });
    const checked = await api<{ checked: number }>(request, accessToken, 'POST', `/api/geo/keywords/${keyword.id}/check`);
    expect(checked.checked).toBe(4);
    await api(request, accessToken, 'POST', `/api/geo/keywords/${keyword.id}/ai-citation`, { aiPlatform: 'deepseek' });
    const tracking = await api<{ keyword: string }[]>(request, accessToken, 'GET', '/api/geo/rank-tracking');
    expect(tracking.some((item) => item.keyword === keyword.word)).toBeTruthy();
    const dual = await api<{ socialCount: number; searchCount: number }>(request, accessToken, 'GET', '/api/geo/dual-engine');
    expect(dual.socialCount + dual.searchCount).toBeGreaterThanOrEqual(0);
    const compare = await api<{ selfRank: number | null; competitorRank: number | null }>(
      request,
      accessToken,
      'GET',
      `/api/geo/competitor-compare?keyword=${encodeURIComponent(keyword.word)}&competitor=${encodeURIComponent('竞品词')}`,
    );
    expect(compare.selfRank).not.toBeNull();
    expect(compare.selfRank as number).toBeGreaterThan(0);
    const advice = await api<{ advice: string }>(
      request,
      accessToken,
      'GET',
      `/api/geo/seo-advice?keyword=${encodeURIComponent(keyword.word)}`,
    );
    expect(advice.advice).toBeTruthy();
    const report = await api<{ id: string }>(request, accessToken, 'POST', '/api/geo/monthly-report');
    expect(report.id).toBeTruthy();
  });

  test('团队审核、任务、绩效、日历与渠道邀请码报表', async ({ request }) => {
    const { accessToken, user } = await login(request);
    const id = stamp();
    const review = await api<{ id: string; status: string }>(request, accessToken, 'POST', '/api/team-collaboration/reviews', {
      title: `E2E审核-${id}`,
    });
    expect(review.status).toBe('pending');
    const reviewed = await api<{ status: string }>(request, accessToken, 'POST', `/api/team-collaboration/reviews/${review.id}/action`, {
      action: 'approve',
      comment: 'E2E 自动审核通过',
    });
    expect(reviewed.status).toBe('approved');
    const task = await api<{ id: string }>(request, accessToken, 'POST', '/api/team-collaboration/tasks', {
      title: `E2E任务-${id}`,
      description: '自动化任务闭环',
      type: 'creation',
      assigneeId: user.id,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const done = await api<{ status: string }>(request, accessToken, 'PATCH', `/api/team-collaboration/tasks/${task.id}`, {
      status: 'done',
    });
    expect(done.status).toBe('done');
    const performance = await api<unknown[]>(request, accessToken, 'GET', '/api/team-collaboration/performance');
    expect(performance.length).toBeGreaterThan(0);
    const event = await api<{ id: string }>(request, accessToken, 'POST', '/api/team-collaboration/calendar', {
      title: `E2E日历-${id}`,
      platform: 'douyin',
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(event.id).toBeTruthy();

    const channel = await api<{ id: string }>(request, accessToken, 'POST', '/api/channels', {
      name: `E2E渠道-${id}`,
      type: 'association',
      contactName: 'E2E联系人',
      contactPhone: '13800000000',
      discountRate: 0.9,
      commissionRate: 0.1,
    });
    const code = await api<{ code: string }>(request, accessToken, 'POST', '/api/channels/codes', {
      channelId: channel.id,
      discountRate: 0.88,
    });
    expect(code.code).toMatch(/^MVMS/);
    const report = await api<{ summary: { registered: number } }>(request, accessToken, 'GET', `/api/channels/report?channelId=${channel.id}`);
    expect(report.summary.registered).toBeGreaterThanOrEqual(0);
  });

  test('爆款详情、拆解、二创生成、编辑与选中', async ({ request }) => {
    const { accessToken } = await login(request);
    const stale = await api<{ list: { id: string; title: string; status: string }[] }>(request, accessToken, 'GET', '/api/hit-recreation/recreations?pageSize=100');
    for (const item of stale.list.filter((row) => row.title.startsWith('E2E二创-') && row.status !== 'published')) {
      await api(request, accessToken, 'DELETE', `/api/hit-recreation/recreations/${item.id}`);
    }
    const peer = await api<{ id: string }>(request, accessToken, 'POST', '/api/hit-recreation/peers', {
      platform: 'douyin',
      nickname: `E2E同行-${stamp()}`,
      followerCount: 1000,
      isBenchmark: false,
    });
    await api(request, accessToken, 'POST', '/api/hit-recreation/crawl');
    const hits = await api<{ list: { id: string }[] }>(request, accessToken, 'GET', '/api/hit-recreation/hits?pageSize=1');
    expect(hits.list.length).toBeGreaterThan(0);
    const hit = await api<{ id: string }>(request, accessToken, 'GET', `/api/hit-recreation/hits/${hits.list[0].id}`);
    await api(request, accessToken, 'POST', `/api/hit-recreation/hits/${hit.id}/teardown`);
    const generated = await api<{ count: number; items: { id: string }[] }>(request, accessToken, 'POST', '/api/hit-recreation/recreations/generate', {
      hitContentId: hit.id,
      style: 'professional',
      platform: 'douyin',
      versionCount: 1,
    });
    expect(generated.count).toBe(1);
    const recreationId = generated.items[0].id;
    const rewriteId = stamp();
    await api(request, accessToken, 'PATCH', `/api/hit-recreation/recreations/${recreationId}`, {
      title: `E2E二创-${stamp()}`,
      body: `批次 ${rewriteId}：车间今天处理一批异形构件，从原料批次追溯开始，经过切割定位、角码组装、注胶养护和成品抽检，每个工位都扫码记录负责人和检测结果。`,
    });
    const selected = await api<{ status: string }>(request, accessToken, 'POST', `/api/hit-recreation/recreations/${recreationId}/select`);
    expect(selected.status).toBe('selected');
    const flywheel = await api<{ totalRecreations: number }>(request, accessToken, 'GET', '/api/hit-recreation/flywheel/stats');
    expect(flywheel.totalRecreations).toBeGreaterThan(0);
    await api(request, accessToken, 'DELETE', `/api/hit-recreation/recreations/${recreationId}`);
    await api(request, accessToken, 'DELETE', `/api/hit-recreation/peers/${peer.id}`);
  });

  test('数据中心、通知、审计日志、增量备份与下载', async ({ request }) => {
    const { accessToken } = await login(request);
    const overview = await api<{ totalAccounts: number }>(request, accessToken, 'GET', '/api/data-center/overview');
    expect(overview.totalAccounts).toBeGreaterThanOrEqual(0);
    await api(request, accessToken, 'GET', '/api/data-center/trend?days=7');
    await api(request, accessToken, 'GET', '/api/data-center/account-ranking');
    await api(request, accessToken, 'GET', '/api/data-center/employee');

    const notifications = await api<{ id: string; read: boolean }[]>(request, accessToken, 'GET', '/api/system/notifications');
    if (notifications.length > 0) {
      const marked = await api<{ read: boolean }>(request, accessToken, 'POST', `/api/system/notifications/${notifications[0].id}/read`);
      expect(marked.read).toBe(true);
    }
    const logs = await api<{ total: number }>(request, accessToken, 'GET', '/api/system/audit-logs?pageSize=5');
    expect(logs.total).toBeGreaterThan(0);
    const backup = await api<{ fileUrl: string; size: number }>(request, accessToken, 'POST', '/api/system/backups', {
      type: 'incremental',
    });
    expect(backup.size).toBeGreaterThan(0);
    const backups = await api<{ id: string; fileUrl: string }[]>(request, accessToken, 'GET', '/api/system/backups');
    const record = backups.find((item) => item.fileUrl === backup.fileUrl);
    expect(record).toBeTruthy();
    const download = await request.get(`/api/system/backups/${record!.id}/download`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(download.ok()).toBeTruthy();
    expect((await download.body()).length).toBeGreaterThan(0);
  });
});
