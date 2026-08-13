import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Button, App, Spin, Modal, Typography, Form, Input, Row, Col, Statistic, Space } from 'antd';
import type { TableColumnsType } from 'antd';
import { geoApi } from '@/api';
import PageContainer from '@/components/PageContainer';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { GeoCompetitorComparison, GeoTrackingInfo } from '@mvms/shared';

const { Paragraph } = Typography;

export default function GeoTracking() {
  const { message } = App.useApp();
  const { data, isLoading } = useQuery({ queryKey: ['geo-tracking'], queryFn: geoApi.tracking });
  const list = data || [];
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [comparison, setComparison] = useState<GeoCompetitorComparison | null>(null);
  const [advice, setAdvice] = useState<Record<string, unknown> | null>(null);

  const reportMut = useMutation({ mutationFn: geoApi.report, onSuccess: (value) => { setReport(value as Record<string, unknown>); message.success('月报已生成'); } });
  const compareMut = useMutation({
    mutationFn: (values: { keyword: string; competitor: string }) => geoApi.competitorCompare(values.keyword, values.competitor),
    onSuccess: setComparison,
  });
  const adviceMut = useMutation({
    mutationFn: (values: { keyword: string }) => geoApi.seoAdvice(values.keyword),
    onSuccess: (value) => setAdvice(value as Record<string, unknown>),
  });

  const columns: TableColumnsType<GeoTrackingInfo> = [
    { title: '关键词', dataIndex: 'keyword' },
    { title: '类型', dataIndex: 'type', render: (t: string) => ({ product: '产品词', industry: '行业词', region: '地域词' }[t] || t) },
    { title: '搜索引擎平均排名', dataIndex: 'avgRank', sorter: (a, b) => Number(a.avgRank ?? Number.MAX_SAFE_INTEGER) - Number(b.avgRank ?? Number.MAX_SAFE_INTEGER), render: (n: number | null) => n === null ? <Tag>未检测</Tag> : <Tag color={n <= 10 ? 'success' : n <= 30 ? 'warning' : 'error'}>第{n}位</Tag> },
    { title: 'AI 引用证据分', dataIndex: 'citationEvidenceScore', render: (n: number | null) => n === null ? <Tag>未检测</Tag> : `${(n * 100).toFixed(0)}%` },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={s === 'good' ? 'success' : s === 'normal' ? 'warning' : s === 'unchecked' ? 'default' : 'error'}>{({ good: '优秀', normal: '一般', poor: '待优化', unchecked: '未检测' }[s] || s)}</Tag> },
  ];

  return (
    <PageContainer title="排名追踪">
      <Card extra={<Button type="primary" loading={reportMut.isPending} onClick={() => reportMut.mutate()}>生成月度报告</Button>}>
        <Spin spinning={isLoading}>
          <Table rowKey="keyword" columns={columns} dataSource={list} pagination={false} />
        </Spin>
      </Card>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="竞品排名对比">
            <Form layout="inline" onFinish={(values) => compareMut.mutate(values)}>
              <Form.Item name="keyword" rules={[{ required: true, message: '请输入我方关键词' }]}><Input placeholder="我方关键词" /></Form.Item>
              <Form.Item name="competitor" rules={[{ required: true, message: '请输入竞品关键词' }]}><Input placeholder="竞品关键词" /></Form.Item>
              <Button htmlType="submit" type="primary" loading={compareMut.isPending}>对比</Button>
            </Form>
            {comparison && (
              <Space direction="vertical" size="middle" style={{ marginTop: 24 }}>
                <Space size="large" wrap>
                  <Statistic
                    title="我方百度排名"
                    value={comparison.selfRank ?? `前 ${comparison.selfMatch.checkedDepth} 位未找到`}
                    prefix={comparison.selfRank === null ? undefined : '第'}
                    suffix={comparison.selfRank === null ? undefined : '位'}
                  />
                  <Statistic
                    title="竞品百度排名"
                    value={comparison.competitorRank ?? `前 ${comparison.competitorMatch.checkedDepth} 位未找到`}
                    prefix={comparison.competitorRank === null ? undefined : '第'}
                    suffix={comparison.competitorRank === null ? undefined : '位'}
                  />
                </Space>
                {comparison.comparison === 'incomplete' && <Tag>至少一方未在检测范围内找到，暂不判断领先</Tag>}
                {comparison.comparison === 'tie' && <Tag color="blue">双方排名持平</Tag>}
                {comparison.comparison === 'self_ahead' && <Tag color="success">我方领先 {Math.abs(comparison.gap || 0)} 位</Tag>}
                {comparison.comparison === 'competitor_ahead' && <Tag color="warning">我方落后 {Math.abs(comparison.gap || 0)} 位</Tag>}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="AI SEO / GEO 优化建议">
            <Form layout="inline" onFinish={(values) => adviceMut.mutate(values)}>
              <Form.Item name="keyword" rules={[{ required: true, message: '请输入关键词' }]}><Input placeholder="待优化关键词" /></Form.Item>
              <Button htmlType="submit" type="primary" loading={adviceMut.isPending}>生成建议</Button>
            </Form>
            {advice && <Paragraph style={{ marginTop: 20, whiteSpace: 'pre-wrap' }} copyable>{advice.advice as string}</Paragraph>}
          </Card>
        </Col>
      </Row>
      <Modal title={`GEO 优化月报 ${report?.month || ''}`} open={!!report} onCancel={() => setReport(null)} footer={<Button type="primary" onClick={() => setReport(null)}>关闭</Button>}>
        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{report?.content as string}</Paragraph>
      </Modal>
    </PageContainer>
  );
}
