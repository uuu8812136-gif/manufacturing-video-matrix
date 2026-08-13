import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Spin, Alert, Empty } from 'antd';
import { geoApi } from '@/api';
import PieChart from '@/components/charts/PieChart';
import PageContainer from '@/components/PageContainer';

export default function DualEngine() {
  const { data, isLoading } = useQuery({ queryKey: ['dual-engine'], queryFn: geoApi.dualEngine });
  const d = (data || {}) as {
    socialLeads?: number;
    searchLeads?: number;
    socialRate?: number;
    searchRate?: number;
    aiCitationEvidenceScore?: number | null;
    searchTrend?: number | null;
  };
  const hasLeadData = (d.socialLeads || 0) + (d.searchLeads || 0) > 0;

  const option = {
    tooltip: { trigger: 'item' },
    legend: { top: '5%', left: 'center' },
    series: [{
      type: 'pie', radius: ['40%', '70%'], avoidLabelOverlap: false,
      label: { show: true, formatter: '{b}: {d}%' },
      data: [
        { value: d.socialLeads || 0, name: '社媒获客', itemStyle: { color: '#1677ff' } },
        { value: d.searchLeads || 0, name: '搜索获客(GEO)', itemStyle: { color: '#52c41a' } },
      ],
    }],
  };

  return (
    <PageContainer title="双引擎数据看板">
      <Spin spinning={isLoading}>
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message="社媒获客数据与搜索获客数据统一看板，双渠道线索归因分析（FR-GEO-011/012）" />
        <Row gutter={16}>
          <Col xs={12} md={6}><Card><Statistic title="社媒获客线索" value={d.socialLeads || 0} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="搜索获客线索" value={d.searchLeads || 0} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="社媒占比" value={d.socialRate || 0} suffix="%" valueStyle={{ color: '#1677ff' }} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="搜索占比" value={d.searchRate || 0} suffix="%" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={12} md={6}><Card><Statistic title="AI 平均引用证据分" value={d.aiCitationEvidenceScore === null || d.aiCitationEvidenceScore === undefined ? '未检测' : d.aiCitationEvidenceScore * 100} precision={1} suffix={d.aiCitationEvidenceScore === null || d.aiCitationEvidenceScore === undefined ? undefined : '%'} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="搜索可见度" value={d.searchTrend === null || d.searchTrend === undefined ? '未检测' : d.searchTrend} precision={1} suffix={d.searchTrend === null || d.searchTrend === undefined ? undefined : '%'} /></Card></Col>
        </Row>
        <Card title="获客来源占比" style={{ marginTop: 16 }}>
          {hasLeadData
            ? <PieChart option={option} style={{ height: 320 }} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实获客数据" style={{ margin: '104px 0' }} />}
        </Card>
      </Spin>
    </PageContainer>
  );
}
