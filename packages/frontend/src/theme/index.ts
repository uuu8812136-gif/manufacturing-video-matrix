import type { ThemeConfig } from 'antd';

export const BRAND = {
  primary: '#1a2b4a',
  accent: '#f59e0b',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  bgLayout: '#f7f8fa',
  textBase: '#0f172a',
  textSecondary: '#64748b',
  border: '#e2e8f0',
} as const;

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: BRAND.primary,
    colorSuccess: BRAND.success,
    colorWarning: BRAND.warning,
    colorError: BRAND.error,
    colorInfo: BRAND.info,
    colorBgLayout: BRAND.bgLayout,
    colorTextBase: BRAND.textBase,
    colorTextSecondary: BRAND.textSecondary,
    colorBorder: BRAND.border,
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    fontFamily: "'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    boxShadow: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    boxShadowSecondary: '0 4px 12px 0 rgba(15, 23, 42, 0.06)',
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 56,
      headerPadding: '0 24px',
      siderBg: '#ffffff',
      bodyBg: '#f7f8fa',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#1a2b4a',
      itemSelectedColor: '#ffffff',
      itemHoverBg: '#f1f5f9',
      itemHeight: 44,
      iconSize: 16,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    },
    Table: {
      headerBg: '#f8fafc',
      headerColor: '#64748b',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f8fafc',
    },
    Statistic: {
      contentFontSize: 28,
    },
  },
};

export const echartsTheme = {
  primary: BRAND.primary,
  accent: BRAND.accent,
  success: BRAND.success,
  warning: BRAND.warning,
  error: BRAND.error,
  info: BRAND.info,
  text: BRAND.textSecondary,
  splitLine: '#f1f5f9',
  axisLine: '#e2e8f0',
};
