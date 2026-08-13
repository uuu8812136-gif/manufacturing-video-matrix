import { test, expect } from '@playwright/test';

const ROUTES: { path: string; title: string }[] = [
  { path: '/dashboard', title: '数据总览' },
  { path: '/accounts', title: '账号矩阵管理' },
  { path: '/accounts/groups', title: '分组管理' },
  { path: '/accounts/dealer', title: '经销商矩阵' },
  { path: '/distribution/publish', title: '一键发布' },
  { path: '/distribution/contents', title: '内容库' },
  { path: '/distribution/tasks', title: '发布队列' },
  { path: '/ai-creation/writing', title: 'AI 智能写作' },
  { path: '/ai-creation/mixcut', title: '视频混剪' },
  { path: '/ai-creation/tts', title: '语音合成' },
  { path: '/ai-creation/extract', title: '文案提取' },
  { path: '/ai-creation/materials', title: '素材库' },
  { path: '/product-library', title: '产品管理' },
  { path: '/digital-human', title: 'IP矩阵' },
  { path: '/digital-human/generate', title: '视频生成' },
  { path: '/geo/keywords', title: '关键词库' },
  { path: '/geo/tracking', title: '排名追踪' },
  { path: '/geo/dual-engine', title: '双引擎看板' },
  { path: '/data-center', title: '数据总览' },
  { path: '/data-center/accounts', title: '账号数据' },
  { path: '/data-center/contents', title: '内容数据' },
  { path: '/data-center/employee', title: '员工数据' },
  { path: '/data-center/hot-topics', title: '热点榜单' },
  { path: '/leads/pool', title: '线索池' },
  { path: '/leads/comments', title: '评论私信' },
  { path: '/leads/forms', title: '留资表单' },
  { path: '/leads/attribution', title: '归因分析' },
  { path: '/leads/crm', title: 'CRM对接' },
  { path: '/team/reviews', title: '内容审核' },
  { path: '/team/tasks', title: '任务分配' },
  { path: '/team/calendar', title: '内容日历' },
  { path: '/team/performance', title: '团队绩效' },
  { path: '/hit-recreation/workbench', title: '二创工作台' },
  { path: '/hit-recreation/hits', title: '爆款情报' },
  { path: '/hit-recreation/peers', title: '同行监控' },
  { path: '/hit-recreation/flywheel', title: '数据飞轮' },
  { path: '/channel', title: '渠道管理' },
  { path: '/channel/report', title: '渠道报表' },
  { path: '/system/members', title: '团队成员' },
  { path: '/system/security', title: '安全设置' },
  { path: '/system/logs', title: '审计日志' },
  { path: '/system/integrations', title: '真实接口接入自检' },
  { path: '/system/backups', title: '备份与恢复' },
];

test.describe('P2 全模块导航巡检', () => {
  for (const route of ROUTES) {
    test(`${route.path} 可访问且无致命错误`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const has404 = await page.getByText('404').count().catch(() => 0);
      const hasTitle = await page.getByText(route.title).first().isVisible().catch(() => false);

      expect.soft(hasTitle, `页面应包含标题“${route.title}”`).toBeTruthy();
      expect(errors, `页面不应有未捕获异常: ${errors.join('; ')}`).toHaveLength(0);
    });
  }
});
