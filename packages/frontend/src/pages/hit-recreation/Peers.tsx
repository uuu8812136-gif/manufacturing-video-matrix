import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, Space, List, Switch, Typography, Popconfirm } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { hitApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_OPTIONS } from '@/constants';
import PageContainer from '@/components/PageContainer';
import { useState } from 'react';

const { Text } = Typography;

export default function Peers() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['peers'], queryFn: hitApi.peers });
  const list = (data as Record<string, unknown>[]) || [];

  const { data: benchmarks } = useQuery({ queryKey: ['benchmarks'], queryFn: hitApi.benchmarks });

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => editing ? hitApi.updatePeer(editing.id as string, v) : hitApi.addPeer(v),
    onSuccess: () => { message.success(editing ? '已更新' : '已添加'); setOpen(false); setEditing(null); form.resetFields(); qc.invalidateQueries({ queryKey: ['peers'] }); qc.invalidateQueries({ queryKey: ['benchmarks'] }); },
  });
  const removeMut = useMutation({
    mutationFn: hitApi.removePeer,
    onSuccess: () => { message.success('已删除同行账号，历史爆款已保留'); qc.invalidateQueries({ queryKey: ['peers'] }); qc.invalidateQueries({ queryKey: ['benchmarks'] }); },
  });
  const toggleBenchmarkMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => hitApi.updatePeer(id, { isBenchmark: value }),
    onSuccess: () => { message.success('标杆状态已更新'); qc.invalidateQueries({ queryKey: ['peers'] }); qc.invalidateQueries({ queryKey: ['benchmarks'] }); },
  });

  const openForm = (row?: Record<string, unknown>) => {
    setEditing(row || null);
    form.setFieldsValue(row ? {
      platform: row.platform,
      nickname: row.nickname,
      followerCount: row.followerCount,
      explosiveThresholdPlay: row.explosiveThresholdPlay,
      isBenchmark: row.isBenchmark,
    } : { explosiveThresholdPlay: 100000, isBenchmark: false });
    setOpen(true);
  };

  const columns = [
    { title: '同行账号', dataIndex: 'nickname' },
    { title: '平台', dataIndex: 'platform', render: (p: string) => <Tag>{PLATFORM_LABELS[p] || p}</Tag> },
    { title: '粉丝数', dataIndex: 'followerCount', render: (n: number) => n?.toLocaleString() },
    { title: '爆款阈值(播放)', dataIndex: 'explosiveThresholdPlay', render: (n: number) => n?.toLocaleString() },
    { title: '标杆', dataIndex: 'isBenchmark', render: (v: boolean) => v ? <Tag color="gold">标杆</Tag> : '-' },
    { title: '已抓取爆款', dataIndex: ['_count', 'hitContents'] },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: Record<string, unknown>) => <Space>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openForm(row)}>编辑</Button>
        <Popconfirm title="删除监控账号？历史爆款内容会保留。" onConfirm={() => removeMut.mutate(row.id as string)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>,
    },
  ];

  return (
    <PageContainer title="同行监控">
      <Card title="行业标杆库（一键订阅）" style={{ marginBottom: 16 }}>
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
          dataSource={(benchmarks as Record<string, unknown>[]) || []}
          renderItem={(b) => (
            <List.Item>
              <Card size="small">
                <Space wrap>
                  <Tag>{PLATFORM_LABELS[b.platform as string]}</Tag>
                  <Text strong>{b.nickname as string}</Text>
                  <Tag color="gold">标杆</Tag>
                  <Button type="link" size="small" onClick={() => toggleBenchmarkMut.mutate({ id: b.id as string, value: false })}>取消标杆</Button>
                </Space>
              </Card>
            </List.Item>
          )}
        />
      </Card>
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => openForm()}>添加同行账号</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Modal title={editing ? '编辑同行账号' : '添加同行账号'} open={open} onCancel={() => { setOpen(false); setEditing(null); form.resetFields(); }} onOk={() => form.submit()} confirmLoading={saveMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate({ ...v, followerCount: Number(v.followerCount) || 0, explosiveThresholdPlay: Number(v.explosiveThresholdPlay) || 100000 })}>
          <Form.Item name="platform" label="平台" rules={[{ required: true }]}><Select options={PLATFORM_OPTIONS} /></Form.Item>
          <Form.Item name="nickname" label="同行账号昵称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="followerCount" label="粉丝数"><Input type="number" /></Form.Item>
          <Form.Item name="explosiveThresholdPlay" label="爆款阈值(播放量)" initialValue={100000}><Input type="number" /></Form.Item>
          <Form.Item name="isBenchmark" label="设为标杆" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
