import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Row, Col, Tag, Button, App, Modal, Form, Select, Spin, Empty, Statistic, Typography, Space, Input } from 'antd';
import { ThunderboltOutlined, FireOutlined, ExperimentOutlined } from '@ant-design/icons';
import { hitApi, productApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_COLORS, PLATFORM_OPTIONS, STYLE_OPTIONS, formatNumber } from '@/constants';
import PageContainer from '@/components/PageContainer';

const { Text, Paragraph } = Typography;

export default function Hits() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [platform, setPlatform] = useState<string>();
  const [teardownModal, setTeardownModal] = useState<Record<string, unknown> | null>(null);
  const [genModal, setGenModal] = useState<Record<string, unknown> | null>(null);
  const [genForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['hits', platform], queryFn: () => hitApi.hits({ page: 1, pageSize: 50, platform }) });
  const list = (data as { list: Record<string, unknown>[] })?.list || [];

  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: () => productApi.list({ page: 1, pageSize: 100 }) });
  const productList = ((products as { list: Record<string, unknown>[] })?.list) || [];

  const crawlMut = useMutation({ mutationFn: hitApi.crawl, onSuccess: (r) => { message.success(`已抓取 ${(r as { crawled: number }).crawled} 条爆款`); qc.invalidateQueries({ queryKey: ['hits'] }); } });
  const teardownMut = useMutation({ mutationFn: (id: string) => hitApi.teardown(id), onSuccess: (r) => { message.success('AI 拆解完成'); setTeardownModal({ ...teardownModal!, teardown: r }); qc.invalidateQueries({ queryKey: ['hits'] }); } });
  const genMut = useMutation({ mutationFn: (v: Record<string, unknown>) => hitApi.generate(v as { hitContentId: string; productId?: string; style?: string; platform?: string; versionCount?: number }), onSuccess: (r) => { message.success(`已生成 ${(r as { count: number }).count} 个版本二创内容`); setGenModal(null); genForm.resetFields(); qc.invalidateQueries({ queryKey: ['recreations'] }); } });

  return (
    <PageContainer title="爆款情报">
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select placeholder="筛选平台" allowClear style={{ width: 160 }} options={PLATFORM_OPTIONS} onChange={setPlatform} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={crawlMut.isPending} onClick={() => crawlMut.mutate()}>立即抓取同行爆款</Button>
          <Text type="secondary">每日定时抓取同行近7天内容，按互动数据排序（FR-BT-003）</Text>
        </Space>
      </Card>
      <Spin spinning={isLoading}>
        {list.length === 0 ? <Empty description="暂无爆款，点击抓取" /> : (
          <Row gutter={[16, 16]}>
            {list.map((hit) => (
              <Col xs={24} sm={12} md={8} key={hit.id as string}>
                <Card hoverable size="small" actions={[
                  <Button size="small" type="link" icon={<ExperimentOutlined />} onClick={() => { setTeardownModal(hit); if (!hit.teardown) teardownMut.mutate(hit.id as string); }}>AI拆解</Button>,
                  <Button size="small" type="link" icon={<FireOutlined />} onClick={() => { setGenModal(hit); genForm.setFieldsValue({ hitContentId: hit.id, style: 'professional', platform: hit.platform, versionCount: 3 }); }}>生成二创</Button>,
                ]}>
                  <Card.Meta
                    title={<Space><Tag color={PLATFORM_COLORS[hit.platform as string]}>{PLATFORM_LABELS[hit.platform as string]}</Tag><Text strong ellipsis style={{ maxWidth: 180 }}>{hit.title as string}</Text></Space>}
                    description={
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary">@{hit.author as string}</Text>
                        <Space>
                          <Statistic value={formatNumber(hit.playCount as number)} prefix="播放" valueStyle={{ fontSize: 13 }} />
                          <Statistic value={formatNumber(hit.likeCount as number)} prefix="赞" valueStyle={{ fontSize: 13 }} />
                          <Statistic value={formatNumber(hit.shareCount as number)} prefix="转" valueStyle={{ fontSize: 13 }} />
                        </Space>
                        {hit.teardown ? <Tag color="green">已拆解</Tag> : <Tag>未拆解</Tag>}
                      </Space>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      <Modal title="AI 爆款拆解报告" open={!!teardownModal} onCancel={() => setTeardownModal(null)} footer={[<Button key="close" onClick={() => setTeardownModal(null)}>关闭</Button>]} width={640}>
        {teardownMut.isPending ? <Spin tip="AI 拆解中..." /> : (
          <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{(teardownModal?.teardown as { report?: string })?.report || '暂无拆解报告'}</Paragraph>
        )}
      </Modal>

      <Modal title="生成二创内容" open={!!genModal} onCancel={() => setGenModal(null)} onOk={() => genForm.submit()} confirmLoading={genMut.isPending}>
        <Form form={genForm} layout="vertical" onFinish={(v) => genMut.mutate({ ...v, versionCount: Number(v.versionCount) })}>
          <Form.Item name="hitContentId" hidden><Input /></Form.Item>
          <Form.Item name="productId" label="关联产品（知识库融合）">
            <Select placeholder="选择企业产品" allowClear>
              {productList.map((p) => <Select.Option key={p.id as string} value={p.id as string}>{p.name as string}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="style" label="风格" rules={[{ required: true }]}><Select options={STYLE_OPTIONS} /></Form.Item>
          <Form.Item name="platform" label="适配平台" rules={[{ required: true }]}><Select options={PLATFORM_OPTIONS} /></Form.Item>
          <Form.Item name="versionCount" label="生成版本数(3-5)" rules={[{ required: true }]}><Select options={[3, 4, 5].map((n) => ({ value: n, label: `${n}个版本` }))} /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
