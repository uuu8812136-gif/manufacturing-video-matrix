import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Row, Col, List, Tag, Button, App, Space, Typography, Modal, Form, Input, Select, Empty, Spin, InputNumber } from 'antd';
import { ThunderboltOutlined, EditOutlined, CheckOutlined, ShareAltOutlined, BarChartOutlined, HistoryOutlined } from '@ant-design/icons';
import { hitApi, accountApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function Workbench() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [publishForm] = Form.useForm();
  const [scoreForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['recreations'], queryFn: () => hitApi.recreations({ page: 1, pageSize: 50 }) });
  const list = (data as { list: Record<string, unknown>[] })?.list || [];

  const { data: accounts } = useQuery({ queryKey: ['accounts-all'], queryFn: () => accountApi.list({ page: 1, pageSize: 100 }) });
  const accountList = ((accounts as { list: Record<string, unknown>[] })?.list) || [];
  const { data: recreationDetail, isLoading: historyLoading } = useQuery({
    queryKey: ['recreation-detail', selected?.id],
    queryFn: () => hitApi.recreation(selected!.id as string),
    enabled: historyOpen && !!selected?.id,
  });
  const history = ((recreationDetail as { history?: Array<{ id: string; createdAt: string; snapshot?: Record<string, unknown> }> })?.history) || [];

  const updateMut = useMutation({
    mutationFn: ({ id, v }: { id: string; v: Record<string, unknown> }) => hitApi.update(id, v),
    onSuccess: (updated) => { message.success('已保存微调'); setSelected(updated as Record<string, unknown>); setEditOpen(false); qc.invalidateQueries({ queryKey: ['recreations'] }); },
  });

  const selectMut = useMutation({
    mutationFn: (id: string) => hitApi.select(id),
    onSuccess: (updated) => { message.success('已选中'); setSelected(updated as Record<string, unknown>); qc.invalidateQueries({ queryKey: ['recreations'] }); },
  });

  const publishMut = useMutation({
    mutationFn: ({ id, accountIds }: { id: string; accountIds: string[] }) => hitApi.publish(id, accountIds),
    onSuccess: () => { message.success('已进入发布队列'); setPublishOpen(false); setSelected((current) => current ? { ...current, status: 'publishing' } : current); qc.invalidateQueries({ queryKey: ['recreations'] }); },
  });
  const scoreMut = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { playCount: number; likeCount: number; commentCount: number; shareCount: number } }) => hitApi.score(id, values),
    onSuccess: (result) => {
      const value = result as { score?: number };
      message.success(`效果已回流，评分 ${value.score ?? '-'}`);
      setScoreOpen(false);
      scoreForm.resetFields();
      qc.invalidateQueries({ queryKey: ['flywheel'] });
    },
  });
  const restoreMut = useMutation({
    mutationFn: ({ id, snapshot }: { id: string; snapshot: Record<string, unknown> }) => {
      let restoredTags: string[] | undefined;
      if (Array.isArray(snapshot.tags)) restoredTags = snapshot.tags as string[];
      else if (typeof snapshot.tags === 'string') {
        try { restoredTags = JSON.parse(snapshot.tags) as string[]; } catch { restoredTags = undefined; }
      }
      return hitApi.update(id, {
        title: snapshot.title,
        body: snapshot.body,
        storyboard: snapshot.storyboard,
        videoUrl: snapshot.videoUrl,
        coverUrl: snapshot.coverUrl,
        tags: restoredTags,
      });
    },
    onSuccess: (updated) => {
      message.success('历史版本已恢复，并保留了恢复前版本');
      setSelected(updated as Record<string, unknown>);
      setHistoryOpen(false);
      qc.invalidateQueries({ queryKey: ['recreations'] });
      qc.invalidateQueries({ queryKey: ['recreation-detail'] });
    },
  });

  const teardown = (selected?.hitContent as { teardown?: Record<string, unknown> } | undefined)?.teardown;
  let structure: { hook?: string; body?: string; cta?: string } = {};
  let script: { framework?: string; keywords?: string[] } = {};
  try { structure = teardown?.structure ? JSON.parse(teardown.structure as string) : {}; } catch { /* */ }
  try { script = teardown?.script ? JSON.parse(teardown.script as string) : {}; } catch { /* */ }

  return (
    <PageContainer title="二创工作台">
      <Card style={{ marginBottom: 16, background: 'linear-gradient(90deg, #fffbe6, #fff)' }}>
        <Space>
          <ThunderboltOutlined style={{ color: '#fa8c16', fontSize: 20 }} />
          <Text strong>每日二创看板</Text>
          <Text type="secondary">基于昨日爆款拆解 + 企业知识库融合自动生成的多版本二创内容，按爆款来源分类</Text>
        </Space>
      </Card>
      <Row gutter={16}>
        <Col xs={24} md={9}>
          <Card title="今日二创内容" bodyStyle={{ padding: 0 }}>
            <Spin spinning={isLoading}>
              {list.length === 0 ? <Empty style={{ padding: 32 }} description="暂无二创内容，请前往爆款情报生成" /> : (
                <List
                  dataSource={list}
                  renderItem={(item) => (
                    <List.Item
                      style={{ cursor: 'pointer', background: selected?.id === item.id ? '#e6f4ff' : undefined, padding: '12px 16px' }}
                      onClick={() => setSelected(item)}
                      actions={[
                        <Button size="small" type="link" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); setSelected(item); editForm.setFieldsValue({ title: item.title, body: item.body, storyboard: item.storyboard, videoUrl: item.videoUrl, coverUrl: item.coverUrl, tags: Array.isArray(item.tags) ? item.tags : [] }); setEditOpen(true); }}>微调</Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={<Space><Tag color={PLATFORM_COLORS[item.platform as string]}>{PLATFORM_LABELS[item.platform as string]}</Tag><Tag>{item.version as string}版</Tag><Text strong>{item.title as string}</Text></Space>}
                        description={<Space size="small"><Text type="secondary">原创度 {((item.originalityScore as number) * 100).toFixed(0)}%</Text>{item.sensitiveHit ? <Tag color="red">敏感词</Tag> : <Tag color="green">合规</Tag>}{item.status === 'selected' && <Tag color="gold">已选中</Tag>}{item.status === 'publishing' && <Tag color="processing">发布中</Tag>}{item.status === 'published' && <Tag color="blue">已发布</Tag>}{item.status === 'failed' && <Tag color="error">发布失败</Tag>}</Space>}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Spin>
          </Card>
        </Col>
        <Col xs={24} md={15}>
          {selected ? (
            <Card title={<Space><Tag color={PLATFORM_COLORS[selected.platform as string]}>{PLATFORM_LABELS[selected.platform as string]}</Tag><Tag>{selected.version as string}版</Tag>左右对比模式</Space>} extra={
              <Space>
                <Button size="small" icon={<CheckOutlined />} onClick={() => selectMut.mutate(selected.id as string)} disabled={selected.status === 'selected'}>选中</Button>
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>历史版本</Button>
                <Button size="small" type="primary" icon={<ShareAltOutlined />} onClick={() => setPublishOpen(true)} disabled={['publishing', 'published'].includes(selected.status as string)}>一键发布</Button>
                <Button size="small" icon={<BarChartOutlined />} onClick={() => setScoreOpen(true)}>回流效果</Button>
              </Space>
            }>
              <Row gutter={16}>
                <Col span={12}>
                  <Card type="inner" title="爆款拆解（原文案结构）" size="small" style={{ background: '#fafafa' }}>
                    <Paragraph><Text strong>开头钩子：</Text>{structure.hook || '-'}</Paragraph>
                    <Paragraph><Text strong>中间内容：</Text>{structure.body || '-'}</Paragraph>
                    <Paragraph><Text strong>结尾CTA：</Text>{structure.cta || '-'}</Paragraph>
                    <Paragraph><Text strong>话术框架：</Text>{script.framework || '-'}</Paragraph>
                    <Paragraph><Text strong>关键词：</Text>{(script.keywords || []).map((k, i) => <Tag key={i}>{k}</Tag>)}</Paragraph>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card type="inner" title="二创内容（企业产品融合）" size="small">
                    <Paragraph strong>{selected.title as string}</Paragraph>
                    <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{selected.body as string}</Paragraph>
                    {(selected.storyboard as string) && <Paragraph><Text type="secondary">分镜：</Text>{selected.storyboard as string}</Paragraph>}
                    {(selected.voiceScript as string) && <Paragraph><Text type="secondary">配音：</Text>{selected.voiceScript as string}</Paragraph>}
                    <Paragraph><Text type="secondary">备选标题：</Text></Paragraph>
                    {((selected.altTitles as string[]) || []).map((t, i) => <div key={i}>· {t}</div>)}
                  </Card>
                </Col>
              </Row>
            </Card>
          ) : (
            <Card><Empty description="选择左侧二创内容查看左右对比" /></Card>
          )}
        </Col>
      </Row>

      <Modal title="在线微调（AI 辅助润色）" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => editForm.submit()} confirmLoading={updateMut.isPending} width={640}>
        <Form form={editForm} layout="vertical" onFinish={(v) => selected && updateMut.mutate({ id: selected.id as string, v })}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="正文" rules={[{ required: true }]}><TextArea rows={6} /></Form.Item>
          <Form.Item name="storyboard" label="分镜脚本"><TextArea rows={2} /></Form.Item>
          <Form.Item name="videoUrl" label="成片视频 URL"><Input placeholder="用于视频平台发布" /></Form.Item>
          <Form.Item name="coverUrl" label="封面 URL"><Input placeholder="图文发布时必填" /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',', '，']} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="一键发布二创内容" open={publishOpen} onCancel={() => setPublishOpen(false)} onOk={() => publishForm.submit()} confirmLoading={publishMut.isPending}>
        <Form form={publishForm} layout="vertical" onFinish={(v) => selected && publishMut.mutate({ id: selected.id as string, accountIds: v.accountIds })}>
          <Form.Item name="accountIds" label="选择发布账号" rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="选择目标账号">
              {accountList.map((a) => <Select.Option key={a.id as string} value={a.id as string}>{a.nickname as string} · {PLATFORM_LABELS[a.platform as string]}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="回流二创发布效果" open={scoreOpen} onCancel={() => setScoreOpen(false)} onOk={() => scoreForm.submit()} confirmLoading={scoreMut.isPending}>
        <Form form={scoreForm} layout="vertical" initialValues={{ playCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 }} onFinish={(values) => selected && scoreMut.mutate({ id: selected.id as string, values })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="playCount" label="播放/阅读量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="likeCount" label="点赞量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="commentCount" label="评论量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="shareCount" label="分享量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
      <Modal title="二创历史版本" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null} width={720}>
        <Spin spinning={historyLoading}>
          <List
            dataSource={history}
            locale={{ emptyText: '暂无历史版本；首次微调后会自动保留' }}
            renderItem={(item, index) => (
              <List.Item
                actions={item.snapshot ? [
                  <Button
                    key="restore"
                    type="link"
                    loading={restoreMut.isPending}
                    onClick={() => restoreMut.mutate({ id: selected!.id as string, snapshot: item.snapshot! })}
                  >
                    恢复此版本
                  </Button>,
                ] : undefined}
              >
                <List.Item.Meta
                  title={`版本 ${history.length - index} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`}
                  description={(
                    <div>
                      <Text strong>{String(item.snapshot?.title || '未命名')}</Text>
                      <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                        {String(item.snapshot?.body || '')}
                      </Paragraph>
                    </div>
                  )}
                />
              </List.Item>
            )}
          />
        </Spin>
      </Modal>
    </PageContainer>
  );
}
