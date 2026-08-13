import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Tag, Button, App, Modal, Form, Input, Space, Select, DatePicker, List } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { accountApi, contentApi, teamApi } from '@/api';
import { PLATFORM_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;

export default function Reviews() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [actionItem, setActionItem] = useState<Record<string, unknown> | null>(null);
  const [comment, setComment] = useState('');
  const [publishItem, setPublishItem] = useState<Record<string, unknown> | null>(null);
  const [annotationItem, setAnnotationItem] = useState<Record<string, unknown> | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [form] = Form.useForm();
  const [publishForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['reviews', page], queryFn: () => teamApi.reviews({ page, pageSize: 10 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;
  const { data: contents } = useQuery({ queryKey: ['contents-review'], queryFn: () => contentApi.list({ page: 1, pageSize: 100 }) });
  const contentList = (contents as { list?: Record<string, unknown>[] })?.list || [];
  const { data: accounts } = useQuery({ queryKey: ['accounts-review'], queryFn: () => accountApi.list({ page: 1, pageSize: 100, status: 'active' }) });
  const accountList = (accounts as { list?: Record<string, unknown>[] })?.list || [];
  const { data: annotations } = useQuery({ queryKey: ['annotations', annotationItem?.contentId], queryFn: () => teamApi.annotations(annotationItem?.contentId as string), enabled: !!annotationItem?.contentId });

  const submitMut = useMutation({ mutationFn: (v: { title: string; contentId?: string }) => teamApi.submitReview(v), onSuccess: () => { message.success('已提交审核'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['reviews'] }); } });
  const actionMut = useMutation({ mutationFn: ({ id, v }: { id: string; v: { action: string; comment?: string } }) => teamApi.reviewAction(id, v), onSuccess: () => { message.success('已处理'); setActionItem(null); setComment(''); qc.invalidateQueries({ queryKey: ['reviews'] }); } });
  const publishMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { accountIds: string[]; scheduledAt?: string } }) => teamApi.publishReview(id, data),
    onSuccess: () => {
      message.success('已加入发布队列');
      setPublishItem(null);
      publishForm.resetFields();
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['publish-tasks'] });
    },
  });
  const annotationMut = useMutation({
    mutationFn: () => teamApi.createAnnotation(annotationItem?.contentId as string, { text: annotationText }),
    onSuccess: () => { message.success('批注已添加'); setAnnotationText(''); qc.invalidateQueries({ queryKey: ['annotations', annotationItem?.contentId] }); },
  });

  const columns = [
    { title: '标题', dataIndex: 'title' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={s === 'approved' ? 'success' : ['rejected', 'failed'].includes(s) ? 'error' : s === 'published' ? 'blue' : s === 'scheduled' ? 'warning' : 'processing'}>
        {({ pending: '待审核', approved: '已通过', rejected: '已驳回', scheduled: '定时中', publishing: '发布中', published: '已发布', failed: '发布失败' }[s] || s)}
      </Tag>,
    },
    { title: '审核意见', dataIndex: 'comment', ellipsis: true, render: (value: string) => value || '-' },
    { title: '提交时间', dataIndex: 'createdAt', render: (t: string) => new Date(t).toLocaleString('zh-CN') },
    { title: '操作', render: (_: unknown, r: Record<string, unknown>) => <Space>
      {r.contentId ? <Button size="small" type="link" onClick={() => setAnnotationItem(r)}>批注</Button> : null}
      {r.status === 'pending' ? <>
          <Button size="small" type="link" onClick={() => setActionItem({ ...r, _action: 'approve' })}>通过</Button>
          <Button size="small" type="link" danger onClick={() => setActionItem({ ...r, _action: 'reject' })}>驳回</Button>
        </> : ['approved', 'failed'].includes(r.status as string) ? <Button size="small" type="link" disabled={!r.contentId} onClick={() => setPublishItem(r)}>{r.status === 'failed' ? '重新发布' : '发布'}</Button> : null}
    </Space> },
  ];

  return (
    <PageContainer title="内容审核">
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>提交审核</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
      </Card>
      <Modal title="提交审核" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={submitMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => submitMut.mutate(v)}>
          <Form.Item name="contentId" label="关联内容" rules={[{ required: true, message: '请选择需要审核的内容' }]}>
            <Select showSearch optionFilterProp="label" options={contentList.map((content) => ({ value: content.id as string, label: content.title as string }))} onChange={(_, option) => form.setFieldValue('title', (option as { label: string }).label)} />
          </Form.Item>
          <Form.Item name="title" label="审核标题" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`${actionItem?._action === 'approve' ? '通过' : '驳回'}审核`} open={!!actionItem} onCancel={() => setActionItem(null)} onOk={() => actionItem && actionMut.mutate({ id: actionItem.id as string, v: { action: actionItem._action as string, comment } })} confirmLoading={actionMut.isPending}>
        <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="审核意见（选填）" />
      </Modal>
      <Modal title="发布已审核内容" open={!!publishItem} onCancel={() => setPublishItem(null)} onOk={() => publishForm.submit()} confirmLoading={publishMut.isPending}>
        <Form form={publishForm} layout="vertical" onFinish={(values) => publishItem && publishMut.mutate({ id: publishItem.id as string, data: { accountIds: values.accountIds, scheduledAt: values.scheduledAt?.toISOString() } })}>
          <Form.Item name="accountIds" label="目标账号" rules={[{ required: true }]}>
            <Select mode="multiple" options={accountList.map((account) => ({ value: account.id as string, label: `${account.nickname as string} · ${PLATFORM_LABELS[account.platform as string] || account.platform}` }))} />
          </Form.Item>
          <Form.Item name="scheduledAt" label="定时发布（可选）"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="内容批注" open={!!annotationItem} onCancel={() => setAnnotationItem(null)} footer={null}>
        <List
          dataSource={(annotations || []) as Array<{ id: string; text: string; createdAt: string; user?: { name?: string } }>}
          locale={{ emptyText: '暂无批注' }}
          renderItem={(item) => <List.Item><List.Item.Meta title={`${item.user?.name || '成员'} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`} description={item.text} /></List.Item>}
        />
        <Space.Compact style={{ width: '100%' }}>
          <Input value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} placeholder="输入批注意见" onPressEnter={() => annotationText.trim() && annotationMut.mutate()} />
          <Button type="primary" loading={annotationMut.isPending} disabled={!annotationText.trim()} onClick={() => annotationMut.mutate()}>添加</Button>
        </Space.Compact>
      </Modal>
    </PageContainer>
  );
}
