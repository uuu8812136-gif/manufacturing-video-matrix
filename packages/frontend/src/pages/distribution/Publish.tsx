import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Form, Select, DatePicker, Button, App, Tabs, Input, Space, Alert } from 'antd';
import { accountApi, contentApi } from '@/api';
import { PLATFORM_LABELS } from '@/constants';
import dayjs from 'dayjs';
import PageContainer from '@/components/PageContainer';

export default function Publish() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const [items, setItems] = useState<{ title: string; videoUrl: string }[]>([]);

  const { data: accounts } = useQuery({ queryKey: ['accounts-all'], queryFn: () => accountApi.list({ page: 1, pageSize: 100 }) });
  const accountList = ((accounts as { list: Record<string, unknown>[] })?.list) || [];
  const { data: contents } = useQuery({ queryKey: ['contents-all'], queryFn: () => contentApi.list({ page: 1, pageSize: 100 }) });
  const contentList = ((contents as { list: Record<string, unknown>[] })?.list) || [];

  const publishMut = useMutation({
    mutationFn: (v: { contentId: string; accountIds: string[]; scheduledAt?: string }) => contentApi.publish(v),
    onSuccess: () => { message.success('已加入发布队列'); form.resetFields(); qc.invalidateQueries({ queryKey: ['publish-tasks'] }); },
  });

  const batchMut = useMutation({
    mutationFn: (v: { items: { title: string; videoUrl: string }[]; accountIds: string[] }) => contentApi.batchImport(v),
    onSuccess: () => { message.success('批量导入发布成功'); setItems([]); batchForm.resetFields(); qc.invalidateQueries({ queryKey: ['publish-tasks'] }); },
  });

  return (
    <PageContainer title="一键发布">
      <Tabs
        items={[
          {
            key: 'single',
            label: '单条发布',
            children: (
              <Card>
                <Alert style={{ marginBottom: 16 }} type="info" showIcon message="支持视频/图文一键发布至多平台、定时发布、自动排队（FR-CD-001~006）" />
                <Form form={form} layout="vertical" onFinish={(v) => publishMut.mutate({ ...v, scheduledAt: v.scheduledAt ? v.scheduledAt.toISOString() : undefined })} style={{ maxWidth: 600 }}>
                  <Form.Item name="contentId" label="选择内容" rules={[{ required: true }]}>
                    <Select options={contentList.map((c) => ({ value: c.id, label: `${c.title}（${c.type === 'video' ? '视频' : '图文'}）` }))} placeholder="选择已创建的内容" />
                  </Form.Item>
                  <Form.Item name="accountIds" label="发布账号（可多选）" rules={[{ required: true }]}>
                    <Select mode="multiple" placeholder="选择目标账号">
                      {accountList.map((a) => <Select.Option key={a.id as string} value={a.id as string}>{a.nickname as string} · {PLATFORM_LABELS[a.platform as string]}</Select.Option>)}
                    </Select>
                  </Form.Item>
                  <Form.Item name="scheduledAt" label="定时发布（可选，未来7天）">
                    <DatePicker showTime style={{ width: '100%' }} disabledDate={(d) => d && d.isAfter(dayjs().add(7, 'day'))} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={publishMut.isPending}>立即发布 / 定时</Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'batch',
            label: '批量导入（最多30条）',
            children: (
              <Card>
                <Alert style={{ marginBottom: 16 }} type="info" showIcon message="批量导入视频标题与链接，一键分发至所选账号（FR-CD-001）" />
                <Form form={batchForm} layout="vertical" style={{ maxWidth: 600 }}>
                  <Form.Item name="accountIds" label="发布账号" rules={[{ required: true }]}>
                    <Select mode="multiple" placeholder="选择目标账号">
                      {accountList.map((a) => <Select.Option key={a.id as string} value={a.id as string}>{a.nickname as string}</Select.Option>)}
                    </Select>
                  </Form.Item>
                  {items.map((it, idx) => (
                    <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Input placeholder={`视频标题 ${idx + 1}`} value={it.title} style={{ width: 260 }} onChange={(e) => setItems((s) => s.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))} />
                      <Input status={!it.videoUrl.trim() ? 'error' : undefined} placeholder="视频链接（必填）" value={it.videoUrl} style={{ width: 260 }} onChange={(e) => setItems((s) => s.map((x, i) => i === idx ? { ...x, videoUrl: e.target.value } : x))} />
                      <Button danger size="small" onClick={() => setItems((s) => s.filter((_, i) => i !== idx))}>删除</Button>
                    </Space>
                  ))}
                  <Space style={{ marginBottom: 16 }}>
                    <Button onClick={() => setItems((s) => [...s, { title: '', videoUrl: '' }])} disabled={items.length >= 30}>添加一条</Button>
                    <Button type="primary" loading={batchMut.isPending} onClick={() => {
                      const accs = batchForm.getFieldValue('accountIds');
                      if (!accs?.length) { message.warning('请选择账号'); return; }
                      if (!items.length || items.some((i) => !i.title.trim())) { message.warning('请填写所有标题'); return; }
                      if (items.some((i) => !i.videoUrl.trim())) { message.warning('请填写每条视频的视频链接'); return; }
                      batchMut.mutate({ items, accountIds: accs });
                    }}>批量发布</Button>
                  </Space>
                </Form>
              </Card>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
