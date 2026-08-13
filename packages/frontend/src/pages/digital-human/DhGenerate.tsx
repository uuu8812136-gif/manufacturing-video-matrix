import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AutoComplete, Card, Form, Select, Input, Button, App, Row, Col, Typography, List, Tag, Modal, Popconfirm } from 'antd';
import { accountApi, dhApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;
const { Text } = Typography;

export default function DhGenerate() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [publishTask, setPublishTask] = useState<Record<string, unknown> | null>(null);
  const [backgroundResult, setBackgroundResult] = useState<string>();
  const [mixcutResult, setMixcutResult] = useState<string>();
  const [publishForm] = Form.useForm();
  const { data: ips } = useQuery({ queryKey: ['dh-ips-all'], queryFn: () => dhApi.ips({ page: 1, pageSize: 100 }) });
  const ipList = ((ips as { list: Record<string, unknown>[] })?.list) || [];

  const { data: tasks, refetch: refetchTasks } = useQuery({ queryKey: ['dh-tasks'], queryFn: () => dhApi.tasks({ page: 1, pageSize: 20 }), refetchInterval: 15000 });
  const taskList = ((tasks as { list: Record<string, unknown>[] })?.list) || [];
  const { data: accounts } = useQuery({ queryKey: ['accounts-dh-publish'], queryFn: () => accountApi.list({ page: 1, pageSize: 200 }) });
  const accountList = ((accounts as { list?: Record<string, unknown>[] })?.list) || [];

  const mut = useMutation({
    mutationFn: (v: { ipId: string; script: string; background?: string }) => dhApi.generate(v),
    onSuccess: (r) => {
      const result = r as { status: string; videoUrl?: string };
      message.success(result.status === 'done' ? '数字人视频生成完成' : '已提交生成任务');
      (document.getElementById('dh-result') as HTMLDivElement).innerText = result.videoUrl ? `视频：${result.videoUrl}` : '任务处理中，可在右侧查看进度';
      refetchTasks();
    },
  });
  const publishMut = useMutation({
    mutationFn: ({ id, accountIds }: { id: string; accountIds: string[] }) => dhApi.publishTask(id, { accountIds }),
    onSuccess: () => { message.success('数字人视频已进入发布队列'); setPublishTask(null); publishForm.resetFields(); },
  });
  const removeTaskMut = useMutation({
    mutationFn: dhApi.removeTask,
    onSuccess: () => {
      message.success('数字人任务已删除');
      qc.invalidateQueries({ queryKey: ['dh-tasks'] });
    },
  });
  const replaceMut = useMutation({
    mutationFn: dhApi.replaceBackground,
    onSuccess: (result) => {
      setBackgroundResult((result as { videoUrl: string }).videoUrl);
      message.success('背景替换完成');
      qc.invalidateQueries({ queryKey: ['dh-tasks'] });
    },
  });
  const mixcutMut = useMutation({
    mutationFn: dhApi.mixcut,
    onSuccess: (result) => {
      setMixcutResult((result as { videoUrl: string }).videoUrl);
      message.success('多数字人混剪完成');
      qc.invalidateQueries({ queryKey: ['dh-tasks'] });
    },
  });

  return (
    <PageContainer title="数字人视频生成">
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="文案驱动数字人播报">
            <Form layout="vertical" onFinish={(v) => mut.mutate(v)}>
              <Form.Item name="ipId" label="选择数字人 IP" rules={[{ required: true }]}>
                <Select placeholder="选择 IP" options={ipList.map((p) => ({ value: p.id, label: p.name }))} />
              </Form.Item>
              <Form.Item
                name="background"
                label="场景背景"
                initialValue="#F3F4F6"
                extra="HeyGen 支持 HTTPS 图片、asset:素材ID 或十六进制纯色；不会再静默忽略无效背景。"
              >
                <AutoComplete
                  options={[
                    { value: '#D1D5DB', label: '工业灰（#D1D5DB）' },
                    { value: '#F8FAFC', label: '展厅白（#F8FAFC）' },
                    { value: '#E0F2FE', label: '办公蓝（#E0F2FE）' },
                  ]}
                  placeholder="https://... / asset:... / #F3F4F6"
                />
              </Form.Item>
              <Form.Item name="script" label="播报文案" rules={[{ required: true }]}>
                <TextArea rows={5} placeholder="输入文案，自动驱动数字人播报生成视频" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={mut.isPending}>生成视频</Button>
            </Form>
            <div id="dh-result" style={{ marginTop: 12, color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="生成任务记录">
            <List
              dataSource={taskList}
              renderItem={(t) => (
                <List.Item actions={[
                  ...(t.status === 'done' && t.videoUrl ? [<Button key="publish" type="link" size="small" onClick={() => setPublishTask(t)}>直接分发</Button>] : []),
                  ...(!['processing', 'pending'].includes(t.status as string) ? [
                    <Popconfirm key="delete" title="确定删除这条生成任务？" onConfirm={() => removeTaskMut.mutate(t.id as string)}>
                      <Button type="link" size="small" danger>删除</Button>
                    </Popconfirm>,
                  ] : []),
                ]}>
                  <List.Item.Meta
                    title={<Text>{(t.ip as { name?: string })?.name || '数字人'} · {t.background as string}</Text>}
                    description={<><Tag color={t.status === 'done' ? 'success' : t.status === 'failed' ? 'error' : 'processing'}>{t.status === 'done' ? '已完成' : t.status === 'failed' ? '失败' : '处理中'}</Tag><Text type="secondary">{(t.script as string)?.slice(0, 40)}...</Text>{t.videoUrl ? <a href={t.videoUrl as string} target="_blank" rel="noreferrer"> 查看视频</a> : null}</>}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="绿幕背景替换">
            <Form layout="vertical" onFinish={(values) => replaceMut.mutate(values)}>
              <Form.Item name="videoUrl" label="数字人绿幕视频 URL" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="bgUrl" label="背景图片 URL" rules={[{ required: true }]}><Input /></Form.Item>
              <Button type="primary" htmlType="submit" loading={replaceMut.isPending}>替换背景</Button>
            </Form>
            {backgroundResult && <div style={{ marginTop: 12 }}>成片：<a href={backgroundResult} target="_blank" rel="noreferrer">{backgroundResult}</a></div>}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="多数字人 IP 混剪">
            <Form layout="vertical" onFinish={(values) => mixcutMut.mutate(values)}>
              <Form.Item name="avatarIds" label="数字人 IP（按选择顺序生成片段）" rules={[{ required: true }]}>
                <Select mode="multiple" options={ipList.map((ip) => ({ value: ip.id as string, label: ip.name as string }))} />
              </Form.Item>
              <Form.Item name="script" label="统一播报文案" rules={[{ required: true }]}><TextArea rows={4} /></Form.Item>
              <Button type="primary" htmlType="submit" loading={mixcutMut.isPending}>生成并混剪</Button>
            </Form>
            {mixcutResult && <div style={{ marginTop: 12 }}>成片：<a href={mixcutResult} target="_blank" rel="noreferrer">{mixcutResult}</a></div>}
          </Card>
        </Col>
      </Row>
      <Modal title="分发数字人视频" open={!!publishTask} onCancel={() => setPublishTask(null)} onOk={() => publishForm.submit()} confirmLoading={publishMut.isPending}>
        <Form form={publishForm} layout="vertical" onFinish={(values) => publishTask && publishMut.mutate({ id: publishTask.id as string, accountIds: values.accountIds })}>
          <Form.Item name="accountIds" label="目标账号" rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="选择账号" options={accountList.map((account) => ({ value: account.id as string, label: `${account.nickname as string} · ${account.platform as string}` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
