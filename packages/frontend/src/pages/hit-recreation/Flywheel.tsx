import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Spin, Alert, Steps, Typography, Progress, Empty } from 'antd';
import { hitApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { Text } = Typography;

export default function Flywheel() {
  const { data, isLoading } = useQuery({ queryKey: ['flywheel'], queryFn: hitApi.flywheel });
  const d = (data || {}) as { totalRecreations?: number; publishedRecreations?: number; avgScore?: number; flywheelLevel?: string | null; effectiveFactors?: Array<{ name: string; score: number }> };
  const hasData = (d.totalRecreations || 0) > 0;

  return (
    <PageContainer title="数据飞轮与自进化">
      <Spin spinning={isLoading}>
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message="数据飞轮" description="仅根据真实二创发布和效果回流数据计算；没有数据时不推断飞轮阶段。" />
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Card><Statistic title="二创内容总数" value={d.totalRecreations || 0} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="已发布数" value={d.publishedRecreations || 0} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="平均效果评分" value={d.avgScore || 0} precision={2} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="当前飞轮阶段" value={d.flywheelLevel || '-'} /></Card></Col>
        </Row>
        <Card title="飞轮三阶段" style={{ marginTop: 16 }}>
          {hasData ? <Steps
            direction="vertical"
            current={d.totalRecreations && d.totalRecreations >= 500 ? 2 : d.totalRecreations && d.totalRecreations >= 50 ? 1 : 0}
            items={[
              { title: '第一层飞轮', description: <Text>单个企业使用 → 积累该企业所属行业的爆款数据 → 二创越来越懂该行业</Text> },
              { title: '第二层飞轮', description: <Text>多个企业使用 → 跨企业数据聚合 → 发现行业级内容趋势</Text> },
              { title: '第三层飞轮', description: <Text>二创效果反馈 → AI 学习哪些拆解维度最有效 → 二创成功率持续提升</Text> },
            ]}
          /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未形成真实数据飞轮" />}
        </Card>
        <Card title="有效拆解维度（效果回流）" style={{ marginTop: 16 }}>
          {(d.effectiveFactors || []).length === 0 ? <Text type="secondary">发布后回流播放、点赞、评论、分享数据，即可形成维度效果评分。</Text> : (d.effectiveFactors || []).map((factor) => <div key={factor.name} style={{ marginBottom: 12 }}><Text>{factor.name}</Text><Progress percent={factor.score} /></div>)}
        </Card>
      </Spin>
    </PageContainer>
  );
}
