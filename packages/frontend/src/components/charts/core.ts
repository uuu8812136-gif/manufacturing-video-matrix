import * as echarts from 'echarts/core';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  TooltipComponent,
]);

export default echarts;
