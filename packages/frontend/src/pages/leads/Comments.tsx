import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Tag, Button, App, Tabs, Input, Form, Modal, Space, Select, Switch, Popconfirm } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { leadApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

export default function Comments() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [replyOpen, setReplyOpen] = useState<Record<string, unknown> | null>(null);
  const [replyText, setReplyText] = useState('');
  const [form] = Form.useForm();

  const { data: comments } = useQuery({ queryKey: ['comments'], queryFn: () => leadApi.comments({ page: 1, pageSize: 20 }) });
  const { data: messages } = useQuery({ queryKey: ['messages'], queryFn: () => leadApi.messages({ page: 1, pageSize: 20 }) });
  const { data: rules } = useQuery({ queryKey: ['auto-reply'], queryFn: leadApi.autoReply });
  const suggest = useMutation({ mutationFn: (ctx: string) => leadApi.aiSuggest(ctx) });

  const replyMut = useMutation({
    mutationFn: ({ id, text, type }: { id: string; text: string; type: 'comment' | 'message' }) =>
      type === 'comment' ? leadApi.replyComment(id, text) : leadApi.replyMessage(id, text),
    onSuccess: () => { message.success('已回复'); setReplyOpen(null); setReplyText(''); qc.invalidateQueries({ queryKey: ['comments'] }); qc.invalidateQueries({ queryKey: ['messages'] }); },
  });

  const ruleMut = useMutation({ mutationFn: (v: Record<string, unknown>) => leadApi.createAutoReply(v), onSuccess: () => { message.success('规则已添加'); form.resetFields(); qc.invalidateQueries({ queryKey: ['auto-reply'] }); } });
  const updateRuleMut = useMutation({ mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => leadApi.updateAutoReply(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['auto-reply'] }) });
  const removeRuleMut = useMutation({ mutationFn: leadApi.removeAutoReply, onSuccess: () => { message.success('规则已删除'); qc.invalidateQueries({ queryKey: ['auto-reply'] }); } });
  const syncMut = useMutation({
    mutationFn: leadApi.syncInteractions,
    onSuccess: (result) => {
      const value = result as { accounts: number; comments: number; messages: number; failed: number; skippedScan: number };
      if (value.accounts === 0 && value.skippedScan > 0) {
        message.warning(`未同步：${value.skippedScan} 个浏览器扫码账号不支持评论/私信同步，请接入官方互动权限或合规网关`);
      } else if (value.skippedScan > 0) {
        message.warning(`同步完成：评论 ${value.comments}，私信 ${value.messages}，失败账号 ${value.failed}；另有 ${value.skippedScan} 个浏览器扫码账号未处理`);
      } else {
        message.success(`同步完成：评论 ${value.comments}，私信 ${value.messages}，失败账号 ${value.failed}`);
      }
      qc.invalidateQueries({ queryKey: ['comments'] });
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const interactionCols = (type: 'comment' | 'message') => [
    { title: '账号', dataIndex: ['account', 'nickname'] },
    { title: '平台', dataIndex: 'platform', render: (p: string) => <Tag color={PLATFORM_COLORS[p]}>{PLATFORM_LABELS[p]}</Tag> },
    { title: '用户', dataIndex: 'userName' },
    { title: type === 'comment' ? '评论内容' : '私信内容', dataIndex: 'text', ellipsis: true },
    { title: '状态', dataIndex: 'replied', render: (v: boolean) => <Tag color={v ? 'success' : 'warning'}>{v ? '已回复' : '待回复'}</Tag> },
    { title: '操作', render: (_: unknown, r: Record<string, unknown>) => <Button size="small" onClick={() => { setReplyOpen({ ...r, _type: type }); setReplyText(''); }}>回复</Button> },
  ];

  return (
    <PageContainer title="评论私信">
      <Space style={{ marginBottom: 12 }}><Button icon={<ReloadOutlined />} loading={syncMut.isPending} onClick={() => syncMut.mutate()}>同步平台互动</Button></Space>
      <Tabs items={[
        { key: 'comment', label: '评论聚合', children: <Card><Table rowKey="id" columns={interactionCols('comment')} dataSource={(comments as { list: Record<string, unknown>[] })?.list || []} pagination={false} /></Card> },
        { key: 'message', label: '私信聚合', children: <Card><Table rowKey="id" columns={interactionCols('message')} dataSource={(messages as { list: Record<string, unknown>[] })?.list || []} pagination={false} /></Card> },
        { key: 'rule', label: '自动回复规则', children: (
          <Card>
            <Form form={form} layout="inline" onFinish={(v) => ruleMut.mutate(v)} style={{ marginBottom: 16 }}>
              <Form.Item name="keyword" rules={[{ required: true }]}><Input placeholder="关键词" /></Form.Item>
              <Form.Item name="reply" rules={[{ required: true }]}><Input placeholder="自动回复内容" style={{ width: 300 }} /></Form.Item>
              <Form.Item name="scope" initialValue="all"><Select style={{ width: 120 }} options={[{ value: 'all', label: '评论+私信' }, { value: 'comment', label: '仅评论' }, { value: 'message', label: '仅私信' }]} /></Form.Item>
              <Button type="primary" htmlType="submit">添加规则</Button>
            </Form>
            <Table rowKey="id" size="small" pagination={false} dataSource={(rules as Record<string, unknown>[]) || []} columns={[
              { title: '关键词', dataIndex: 'keyword' },
              { title: '回复', dataIndex: 'reply' },
              { title: '范围', dataIndex: 'scope', render: (value: string) => ({ all: '评论+私信', comment: '仅评论', message: '仅私信' }[value] || value) },
              { title: '启用', dataIndex: 'enabled', render: (enabled: boolean, row: Record<string, unknown>) => <Switch checked={enabled} loading={updateRuleMut.isPending} onChange={(checked) => updateRuleMut.mutate({ id: row.id as string, data: { enabled: checked } })} /> },
              { title: '操作', render: (_: unknown, row: Record<string, unknown>) => <Popconfirm title="确定删除该规则？" onConfirm={() => removeRuleMut.mutate(row.id as string)}><Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm> },
            ]} />
          </Card>
        ) },
      ]} />
      <Modal title="回复" open={!!replyOpen} onCancel={() => setReplyOpen(null)} onOk={() => replyOpen && replyMut.mutate({ id: replyOpen.id as string, text: replyText, type: replyOpen._type as 'comment' | 'message' })} okButtonProps={{ disabled: !replyText.trim() }} confirmLoading={replyMut.isPending}>
        <p style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>{replyOpen?.text as string}</p>
        <Input.TextArea rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="输入回复内容" />
        <Button size="small" type="link" loading={suggest.isPending} onClick={() => { suggest.mutate(replyOpen?.text as string); }}>AI 建议回复</Button>
        {suggest.data && <Card size="small" style={{ marginTop: 8 }}><div>{(suggest.data as { reply: string }).reply}</div><Button size="small" type="link" onClick={() => setReplyText((suggest.data as { reply: string }).reply)}>采用</Button></Card>}
      </Modal>
    </PageContainer>
  );
}
