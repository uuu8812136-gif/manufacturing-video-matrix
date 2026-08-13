import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Tag, Button, App, Modal, Form, Input, Select, DatePicker } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { teamApi, userApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const STATUS = { todo: ['待处理', 'default'], in_progress: ['进行中', 'processing'], done: ['已完成', 'success'] } as const;

export default function Tasks() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['tasks', page], queryFn: () => teamApi.tasks({ page, pageSize: 10 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;
  const { data: members } = useQuery({ queryKey: ['members'], queryFn: userApi.members });
  const memberList = (members as Record<string, unknown>[]) || [];

  const createMut = useMutation({ mutationFn: (v: Record<string, unknown>) => teamApi.createTask(v), onSuccess: () => { message.success('已创建'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['tasks'] }); } });
  const updateMut = useMutation({ mutationFn: ({ id, v }: { id: string; v: Record<string, unknown> }) => teamApi.updateTask(id, v), onSuccess: () => { message.success('已更新'); qc.invalidateQueries({ queryKey: ['tasks'] }); } });

  const columns = [
    { title: '任务', dataIndex: 'title' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag>{({ creation: '创作', publish: '发布', review: '审核' }[t] || t)}</Tag> },
    { title: '负责人', dataIndex: ['assignee', 'name'], render: (v: string) => v || '-' },
    { title: '截止日期', dataIndex: 'dueDate', render: (t: string) => t ? new Date(t).toLocaleDateString('zh-CN') : '-' },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={STATUS[s as keyof typeof STATUS]?.[1]}>{STATUS[s as keyof typeof STATUS]?.[0] || s}</Tag> },
    { title: '操作', render: (_: unknown, r: Record<string, unknown>) => (
      <Select size="small" defaultValue={r.status} style={{ width: 110 }} onChange={(v) => updateMut.mutate({ id: r.id as string, v: { status: v } })}>
        <Select.Option value="todo">待处理</Select.Option>
        <Select.Option value="in_progress">进行中</Select.Option>
        <Select.Option value="done">已完成</Select.Option>
      </Select>
    ) },
  ];

  return (
    <PageContainer title="任务分配">
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>创建任务</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
      </Card>
      <Modal title="创建任务" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate({ ...v, dueDate: v.dueDate ? v.dueDate.toISOString() : undefined })}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="type" label="类型" initialValue="creation"><Select options={[{ value: 'creation', label: '创作' }, { value: 'publish', label: '发布' }, { value: 'review', label: '审核' }]} /></Form.Item>
          <Form.Item name="assigneeId" label="负责人"><Select allowClear options={memberList.map((m) => ({ value: m.id, label: m.name }))} /></Form.Item>
          <Form.Item name="dueDate" label="截止日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
