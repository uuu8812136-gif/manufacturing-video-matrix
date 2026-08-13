import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, Alert, Tabs, Switch, Space, Popconfirm } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { dhApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const providers = [
  { value: 'heygen', label: 'HeyGen' },
  { value: 'guiji', label: '硅基智能' },
  { value: 'zhiying', label: '智影' },
];

export default function DigitalHumanIp() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [ipOpen, setIpOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [editingIp, setEditingIp] = useState<Record<string, unknown> | null>(null);
  const [editingAvatar, setEditingAvatar] = useState<Record<string, unknown> | null>(null);
  const [ipForm] = Form.useForm();
  const [avatarForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['dh-ips', page], queryFn: () => dhApi.ips({ page, pageSize: 10 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;
  const { data: avatars, isLoading: avatarLoading } = useQuery({ queryKey: ['dh-avatars'], queryFn: dhApi.avatars });
  const avatarList = (avatars as Record<string, unknown>[]) || [];
  const { data: strategy } = useQuery({ queryKey: ['dh-strategy'], queryFn: dhApi.strategy });

  const ipMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => editingIp ? dhApi.updateIp(editingIp.id as string, values) : dhApi.createIp(values),
    onSuccess: () => { message.success(editingIp ? 'IP 已更新' : 'IP 已创建'); setIpOpen(false); setEditingIp(null); ipForm.resetFields(); qc.invalidateQueries({ queryKey: ['dh-ips'] }); qc.invalidateQueries({ queryKey: ['dh-strategy'] }); },
  });
  const avatarMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => editingAvatar ? dhApi.updateAvatar(editingAvatar.id as string, values) : dhApi.createAvatar(values),
    onSuccess: () => { message.success('数字人形象已保存'); setAvatarOpen(false); setEditingAvatar(null); avatarForm.resetFields(); qc.invalidateQueries({ queryKey: ['dh-avatars'] }); qc.invalidateQueries({ queryKey: ['dh-ips'] }); },
  });
  const removeIp = useMutation({
    mutationFn: dhApi.removeIp,
    onSuccess: () => { message.success('数字人 IP 已删除'); qc.invalidateQueries({ queryKey: ['dh-ips'] }); qc.invalidateQueries({ queryKey: ['dh-strategy'] }); },
  });
  const removeAvatar = useMutation({
    mutationFn: dhApi.removeAvatar,
    onSuccess: () => { message.success('数字人形象已删除'); qc.invalidateQueries({ queryKey: ['dh-avatars'] }); },
  });

  const openIp = (row?: Record<string, unknown>) => {
    setEditingIp(row || null);
    ipForm.setFieldsValue(row ? {
      name: row.name,
      provider: row.provider,
      avatarId: row.avatarId,
      persona: row.persona,
    } : { provider: 'heygen' });
    setIpOpen(true);
  };
  const openAvatar = (row?: Record<string, unknown>) => {
    setEditingAvatar(row || null);
    avatarForm.setFieldsValue(row ? {
      name: row.name,
      provider: row.provider,
      avatarKey: row.avatarKey,
      voiceKey: row.voiceKey,
      custom: row.custom,
    } : { provider: 'heygen', custom: false });
    setAvatarOpen(true);
  };

  const ipColumns = [
    { title: 'IP名称', dataIndex: 'name' },
    { title: '服务商', dataIndex: 'provider', render: (provider: string) => <Tag>{providers.find((item) => item.value === provider)?.label || provider}</Tag> },
    { title: '绑定形象', dataIndex: ['avatar', 'name'], render: (value: string) => value || '-' },
    { title: '人设', dataIndex: 'persona', render: (value: string) => value || '-' },
    { title: '视频数', dataIndex: 'videoCount' },
    { title: '总播放', dataIndex: 'totalPlay', render: (value: number) => value?.toLocaleString() },
    { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'active' ? 'success' : 'default'}>{status === 'active' ? '活跃' : status}</Tag> },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: Record<string, unknown>) => <Space>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openIp(row)}>编辑</Button>
        <Popconfirm title="仅无生成任务的 IP 可删除，确定继续？" onConfirm={() => removeIp.mutate(row.id as string)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>,
    },
  ];
  const avatarColumns = [
    { title: '形象名称', dataIndex: 'name' },
    { title: '服务商', dataIndex: 'provider', render: (provider: string) => <Tag>{providers.find((item) => item.value === provider)?.label || provider}</Tag> },
    { title: '形象 ID', dataIndex: 'avatarKey', ellipsis: true, render: (value: string) => value || '-' },
    { title: '音色 ID', dataIndex: 'voiceKey', ellipsis: true, render: (value: string) => value || '-' },
    { title: '定制形象', dataIndex: 'custom', render: (value: boolean) => value ? '是' : '否' },
    { title: 'IP 数', dataIndex: ['_count', 'ips'] },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: Record<string, unknown>) => <Space>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openAvatar(row)}>编辑</Button>
        <Popconfirm title="仅未绑定 IP 的形象可删除，确定继续？" onConfirm={() => removeAvatar.mutate(row.id as string)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>,
    },
  ];

  return (
    <PageContainer title="数字人 IP 矩阵">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message={(strategy as { advice?: string })?.advice || '先录入服务商形象 ID/音色 ID，再创建并绑定数字人 IP；配置 API Key 后即可生成。'} />
      <Card>
        <Tabs items={[
          {
            key: 'ips', label: 'IP 矩阵', children: <>
              <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => openIp()}>创建数字人 IP</Button>
              <Table rowKey="id" loading={isLoading} columns={ipColumns} dataSource={list} pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
            </>,
          },
          {
            key: 'avatars', label: '形象与音色', children: <>
              <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => openAvatar()}>录入数字人形象</Button>
              <Table rowKey="id" loading={avatarLoading} columns={avatarColumns} dataSource={avatarList} pagination={false} />
            </>,
          },
        ]} />
      </Card>

      <Modal title={editingIp ? '编辑数字人 IP' : '创建数字人 IP'} open={ipOpen} onCancel={() => { setIpOpen(false); setEditingIp(null); ipForm.resetFields(); }} onOk={() => ipForm.submit()} confirmLoading={ipMut.isPending}>
        <Form form={ipForm} layout="vertical" onFinish={(values) => ipMut.mutate(values)}>
          <Form.Item name="name" label="IP 名称" rules={[{ required: true }, { max: 80 }]}><Input /></Form.Item>
          <Form.Item name="provider" label="服务商" rules={[{ required: true }]}><Select options={providers} /></Form.Item>
          <Form.Item name="avatarId" label="绑定形象" rules={[{ required: true, message: '请选择数字人形象' }]}>
            <Select placeholder="请选择已配置的数字人形象" options={avatarList.map((avatar) => ({ value: avatar.id as string, label: `${avatar.name as string} · ${avatar.provider as string}` }))} />
          </Form.Item>
          <Form.Item name="persona" label="人设定位"><Input placeholder="如：门窗行业技术顾问" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={editingAvatar ? '编辑数字人形象与音色' : '录入数字人形象与音色'} open={avatarOpen} onCancel={() => { setAvatarOpen(false); setEditingAvatar(null); avatarForm.resetFields(); }} onOk={() => avatarForm.submit()} confirmLoading={avatarMut.isPending}>
        <Form form={avatarForm} layout="vertical" onFinish={(values) => avatarMut.mutate(values)}>
          <Form.Item name="name" label="形象名称" rules={[{ required: true }, { max: 80 }]}><Input /></Form.Item>
          <Form.Item name="provider" label="服务商" rules={[{ required: true }]}><Select options={providers} /></Form.Item>
          <Form.Item name="avatarKey" label="服务商 Avatar/Model ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="voiceKey" label="服务商 Voice ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="custom" label="是否为企业定制形象" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
