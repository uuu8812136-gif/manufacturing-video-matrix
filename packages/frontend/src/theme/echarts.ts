import { echartsTheme } from './index';

export function getBaseEchartsOption() {
  return {
    grid: { top: 24, right: 16, bottom: 32, left: 48 },
    textStyle: { fontFamily: 'Inter, sans-serif', color: echartsTheme.text },
    color: [echartsTheme.primary, echartsTheme.accent, echartsTheme.success, echartsTheme.info],
    xAxis: {
      axisLine: { lineStyle: { color: echartsTheme.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: echartsTheme.text, fontSize: 12 },
      splitLine: { show: false },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: echartsTheme.text, fontSize: 12 },
      splitLine: { lineStyle: { color: echartsTheme.splitLine, type: 'dashed' as const } },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 13 },
      padding: [8, 12],
    },
  };
}
