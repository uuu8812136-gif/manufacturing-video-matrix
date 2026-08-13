import {
  DashboardOutlined,
  TeamOutlined,
  ShareAltOutlined,
  EditOutlined,
  RobotOutlined,
  GlobalOutlined,
  BarChartOutlined,
  MessageOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface MenuItem {
  path: string;
  name: string;
  icon?: ReactNode;
  roles?: string[];
  systemOnly?: boolean;
}

export interface MenuGroup {
  path: string;
  name: string;
  icon?: ReactNode;
  children: MenuItem[];
  roles?: string[];
  systemOnly?: boolean;
}

export const menuConfig: MenuGroup[] = [
  {
    path: '/dashboard',
    name: '工作台',
    icon: <DashboardOutlined />,
    children: [{ path: '/dashboard', name: '数据总览' }],
  },
  {
    path: '/accounts',
    name: '账号矩阵管理',
    icon: <TeamOutlined />,
    children: [
      { path: '/accounts', name: '账号列表' },
      { path: '/accounts/groups', name: '分组管理' },
      { path: '/accounts/dealer', name: '经销商矩阵' },
    ],
  },
  {
    path: '/distribution',
    name: '内容智能分发',
    icon: <ShareAltOutlined />,
    children: [
      { path: '/distribution/publish', name: '一键发布' },
      { path: '/distribution/contents', name: '内容库' },
      { path: '/distribution/tasks', name: '发布队列' },
    ],
  },
  {
    path: '/ai-creation',
    name: 'AI内容创作',
    icon: <EditOutlined />,
    children: [
      { path: '/ai-creation/writing', name: 'AI写作' },
      { path: '/ai-creation/mixcut', name: '视频混剪' },
      { path: '/ai-creation/tts', name: '语音合成' },
      { path: '/ai-creation/extract', name: '文案提取' },
      { path: '/ai-creation/materials', name: '素材库' },
    ],
  },
  {
    path: '/product-library',
    name: '产品信息库',
    icon: <ApartmentOutlined />,
    children: [{ path: '/product-library', name: '产品管理' }],
  },
  {
    path: '/digital-human',
    name: '数字人IP引擎',
    icon: <RobotOutlined />,
    children: [
      { path: '/digital-human', name: 'IP矩阵' },
      { path: '/digital-human/generate', name: '视频生成' },
    ],
  },
  {
    path: '/geo',
    name: 'GEO搜索获客',
    icon: <GlobalOutlined />,
    children: [
      { path: '/geo/keywords', name: '关键词库' },
      { path: '/geo/tracking', name: '排名追踪' },
      { path: '/geo/dual-engine', name: '双引擎看板' },
    ],
  },
  {
    path: '/data-center',
    name: '数据中心',
    icon: <BarChartOutlined />,
    children: [
      { path: '/data-center', name: '数据总览' },
      { path: '/data-center/accounts', name: '账号数据' },
      { path: '/data-center/contents', name: '内容数据' },
      { path: '/data-center/employee', name: '员工数据' },
      { path: '/data-center/hot-topics', name: '热点榜单' },
    ],
  },
  {
    path: '/leads',
    name: '互动与线索闭环',
    icon: <MessageOutlined />,
    children: [
      { path: '/leads/pool', name: '线索池' },
      { path: '/leads/comments', name: '评论私信' },
      { path: '/leads/forms', name: '留资表单' },
      { path: '/leads/attribution', name: '归因分析' },
      { path: '/leads/crm', name: 'CRM对接' },
    ],
  },
  {
    path: '/team',
    name: '团队协作',
    icon: <CalendarOutlined />,
    children: [
      { path: '/team/reviews', name: '内容审核' },
      { path: '/team/tasks', name: '任务分配' },
      { path: '/team/calendar', name: '内容日历' },
      { path: '/team/performance', name: '团队绩效', roles: ['super_admin', 'ops_lead'] },
    ],
  },
  {
    path: '/hit-recreation',
    name: '智能爆款二创引擎',
    icon: <ThunderboltOutlined />,
    children: [
      { path: '/hit-recreation/workbench', name: '二创工作台' },
      { path: '/hit-recreation/hits', name: '爆款情报' },
      { path: '/hit-recreation/peers', name: '同行监控' },
      { path: '/hit-recreation/flywheel', name: '数据飞轮' },
    ],
  },
  {
    path: '/channel',
    name: '渠道合作体系',
    icon: <ApartmentOutlined />,
    roles: ['super_admin'],
    systemOnly: true,
    children: [
      { path: '/channel', name: '渠道管理' },
      { path: '/channel/report', name: '渠道报表' },
    ],
  },
  {
    path: '/system',
    name: '系统设置',
    icon: <SettingOutlined />,
    children: [
      { path: '/system/members', name: '团队成员', roles: ['super_admin', 'ops_lead'] },
      { path: '/system/security', name: '安全设置' },
      { path: '/system/logs', name: '审计日志', roles: ['super_admin', 'ops_lead'] },
      { path: '/system/integrations', name: '接入自检', roles: ['super_admin'], systemOnly: true },
      { path: '/system/backups', name: '备份与恢复', roles: ['super_admin'], systemOnly: true },
    ],
  },
];
