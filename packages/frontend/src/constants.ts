export const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  video_account: '微信视频号',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  bilibili: '哔哩哔哩',
  baijiahao: '百家号',
};

export const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }));

export const PLATFORM_COLORS: Record<string, string> = {
  douyin: 'volcano',
  video_account: 'green',
  kuaishou: 'orange',
  xiaohongshu: 'red',
  bilibili: 'pink',
  baijiahao: 'blue',
};

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  ops_lead: '运营主管',
  dealer: '经销商',
  content_editor: '内容编辑',
};

export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'red',
  ops_lead: 'orange',
  dealer: 'blue',
  content_editor: 'green',
};

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: '新线索',
  assigned: '已分配',
  following: '跟进中',
  intended: '高意向',
  deal: '已成交',
  lost: '已流失',
};

export const LEAD_STATUS_COLORS: Record<string, string> = {
  new: 'blue',
  assigned: 'cyan',
  following: 'orange',
  intended: 'gold',
  deal: 'green',
  lost: 'default',
};

export const INTENTION_LABELS: Record<string, string> = {
  high: '高意向',
  medium: '中意向',
  low: '低意向',
};

export const PUBLISH_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  publishing: '发布中',
  published: '已发布',
  failed: '失败',
  scheduled: '定时中',
  cancelled: '已取消',
};

export const PUBLISH_STATUS_COLORS: Record<string, string> = {
  queued: 'default',
  publishing: 'processing',
  published: 'success',
  failed: 'error',
  scheduled: 'warning',
  cancelled: 'default',
};

export const STYLE_OPTIONS = [
  { value: 'professional', label: '专业严肃' },
  { value: 'humorous', label: '轻松幽默' },
  { value: 'story', label: '故事化' },
  { value: 'compare', label: '对比评测' },
];

export const formatNumber = (n: number) => {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
};
