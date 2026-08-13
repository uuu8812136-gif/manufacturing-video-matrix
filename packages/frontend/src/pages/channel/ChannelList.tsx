import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, InputNumber, Space, Typography } from 'antd';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import { channelApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { Text } = Typography;

function formatDiscount(value: unknown) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return '-';
  const discount = rate * 10;
  return `${Number.isInteger(discount) ? discount.toFixed(0) : discount.toFixed(1)}折`;
}

export default function ChannelList() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [form] = Form.useForm();
  const [codeForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['channels'], queryFn: () => channelApi.list({ page: 1, pageSize: 50 }) });
  const list = (data as { list: Record<string, unknown>[] })?.list || [];
  const { data: codes } = useQuery({ queryKey: ['channel-codes'], queryFn: () => channelApi.codes() });

  const createMut = useMutation({ mutationFn: (v: Record<string, unknown>) => channelApi.create(v), onSuccess: () => { message.success('已创建'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['channels'] }); } });
  const codeMut = useMutation({ mutationFn: (v: { channelId: string; discountRate?: number }) => channelApi.createCode(v), onSuccess: () => { message.success('邀请码已生成'); setCodeOpen(false); codeForm.resetFields(); qc.invalidateQueries({ queryKey: ['channel-codes'] }); } });

  const columns = [
    { title: '渠道名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag color={t === 'industrial_park' ? 'blue' : 'purple'}>{t === 'industrial_park' ? '产业园区' : '制造业协会'}</Tag> },
    { title: '联系人', dataIndex: 'contactName', render: (v: string) => v || '-' },
    { title: '折扣', dataIndex: 'discountRate', render: formatDiscount },
    { title: '返佣比例', dataIndex: 'commissionRate', render: (n: number) => `${(n * 100).toFixed(0)}%` },
  ];

  const codeColumns = [
    { title: '邀请码', dataIndex: 'code', render: (c: string) => <Space><Text strong>{c}</Text><Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(c); message.success('已复制'); }} /></Space> },
    { title: '渠道', dataIndex: ['channel', 'name'] },
    { title: '折扣', dataIndex: 'discountRate', render: formatDiscount },
    { title: '注册客户数', dataIndex: ['_count', 'customers'] },
  ];

  return (
    <PageContainer title="渠道管理">
      <Card title="渠道列表（园区/协会）" style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>创建渠道</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Card title="邀请码体系" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCodeOpen(true)}>生成邀请码</Button>}>
        <Table rowKey="id" size="small" columns={codeColumns} dataSource={(codes as Record<string, unknown>[]) || []} pagination={false} />
      </Card>
      <Modal title="创建渠道" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate({ ...v, discountRate: Number(v.discountRate), commissionRate: Number(v.commissionRate) })}>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}><Select options={[{ value: 'industrial_park', label: '产业园区' }, { value: 'association', label: '制造业协会' }]} /></Form.Item>
          <Form.Item name="contactName" label="联系人"><Input /></Form.Item>
          <Form.Item name="contactPhone" label="联系电话"><Input /></Form.Item>
          <Form.Item name="discountRate" label="首年折扣(0-1)" initialValue={0.5}><InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="commissionRate" label="返佣比例(0-1)" initialValue={0.18}><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="生成邀请码" open={codeOpen} onCancel={() => setCodeOpen(false)} onOk={() => codeForm.submit()} confirmLoading={codeMut.isPending}>
        <Form form={codeForm} layout="vertical" onFinish={(v) => codeMut.mutate({ ...v, discountRate: v.discountRate ? Number(v.discountRate) : undefined })}>
          <Form.Item name="channelId" label="渠道" rules={[{ required: true }]}><Select options={list.map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>
          <Form.Item name="discountRate" label="折扣(0-1)"><InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
