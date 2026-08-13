import type { ComponentProps } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { PieChart as PieSeries } from 'echarts/charts';
import { LabelLayout } from 'echarts/features';
import echarts from './core';

echarts.use([LabelLayout, PieSeries]);

type Props = Omit<ComponentProps<typeof ReactEChartsCore>, 'echarts'>;

export default function PieChart(props: Props) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
