import type { ComponentProps } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BarChart, LineChart } from 'echarts/charts';
import echarts from './core';

echarts.use([BarChart, LineChart]);

type Props = Omit<ComponentProps<typeof ReactEChartsCore>, 'echarts'>;

export default function LineBarChart(props: Props) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
