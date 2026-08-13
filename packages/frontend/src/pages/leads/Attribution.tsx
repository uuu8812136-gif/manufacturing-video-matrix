import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Spin, Alert, Table, Tabs, Tag, Empty } from 'antd';
import { leadApi } from '@/api';
import LineBarChart from '@/components/charts/LineBarChart';
import PieChart from '@/components/charts/PieChart';
import { LEAD_STATUS_LABELS, PLATFORM_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';

type AttributionData = {
  total?: number;
  deal?: number;
  conversionRate?: number;
  revenue?: number;
  cost?: number;
  roi?: number | null;
  byPlatform?: { platform: string; count: number }[];
  byContent?: { content: string; count: number }[];
  byAccount?: { accountId: string; nickname: string; platform: string; count: number }[];
  funnel?: { status: string; count: number }[];
};

export default function Attribution() {
  const { data, isLoading } = useQuery({ queryKey: ['attribution'], queryFn: leadApi.attribution });
  const value = (data || {}) as AttributionData;

  const sourceOption = {
    tooltip: { trigger: 'item' },
    legend: { top: '5%', left: 'center' },
    series: [{
      type: 'pie', radius: ['38%', '66%'],
      label: { formatter: '{b}: {c} ({d}%)' },
      data: (value.byPlatform || []).map((item) => ({ value: item.count, name: PLATFORM_LABELS[item.platform] || item.platform })),
    }],
  };
  const funnelOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 30, right: 20, top: 20, bottom: 35, containLabel: true },
    xAxis: { type: 'category', data: (value.funnel || []).map((item) => LEAD_STATUS_LABELS[item.status] || item.status) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: (value.funnel || []).map((item) => item.count), itemStyle: { color: '#1677ff', borderRadius: [4, 4, 0, 0] } }],
  };

  return (
    <PageContainer title="线索归因分析">
      <Spin spinning={isLoading}>
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message="来源平台、内容、账号与成交金额已打通；录入获客成本后自动计算 ROI。" />
        <Row gutter={[16, 16]}>
          <Col xs={12} md={4}><Card><Statistic title="线索总数" value={value.total || 0} /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="成交数" value={value.deal || 0} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="转化率" value={value.conversionRate || 0} suffix="%" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="成交金额" value={value.revenue || 0} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="获客成本" value={value.cost || 0} precision={2} prefix="¥" /></Card></Col>
          <Col xs={12} md={4}><Card><Statistic title="ROI" value={value.roi ?? 0} suffix={value.roi == null ? '' : '%'} valueStyle={{ color: (value.roi || 0) >= 0 ? '#3f8600' : '#cf1322' }} /></Card></Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}><Card title="线索来源分布">{(value.byPlatform || []).length > 0 ? <PieChart option={sourceOption} style={{ height: 320 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实来源数据" style={{ margin: '104px 0' }} />}</Card></Col>
          <Col xs={24} lg={12}><Card title="跟进转化漏斗">{(value.funnel || []).length > 0 ? <LineBarChart option={funnelOption} style={{ height: 320 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实转化数据" style={{ margin: '104px 0' }} />}</Card></Col>
        </Row>
        <Card title="多维归因明细" style={{ marginTop: 16 }}>
          <Tabs items={[
            { key: 'content', label: '来源内容', children: <Table rowKey="content" size="small" pagination={false} dataSource={value.byContent || []} columns={[{ title: '内容', dataIndex: 'content' }, { title: '线索数', dataIndex: 'count', width: 120, sorter: (a, b) => a.count - b.count }]} /> },
            { key: 'account', label: '来源账号', children: <Table rowKey="accountId" size="small" pagination={false} dataSource={value.byAccount || []} columns={[{ title: '账号', dataIndex: 'nickname' }, { title: '平台', dataIndex: 'platform', render: (platform: string) => <Tag>{PLATFORM_LABELS[platform] || platform}</Tag> }, { title: '线索数', dataIndex: 'count', width: 120 }]} /> },
            { key: 'platform', label: '来源平台', children: <Table rowKey="platform" size="small" pagination={false} dataSource={value.byPlatform || []} columns={[{ title: '平台', dataIndex: 'platform', render: (platform: string) => PLATFORM_LABELS[platform] || platform }, { title: '线索数', dataIndex: 'count', width: 120 }]} /> },
          ]} />
        </Card>
      </Spin>
    </PageContainer>
  );
}
