import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import { leadApi } from '@/api';
import PageContainer from '@/components/PageContainer';

type CrmRow = Record<string, unknown> & {
  id: string;
  provider: string;
  enabled: boolean;
};

type WebhookRow = Record<string, unknown> & {
  id: string;
  url: string;
  events?: string;
  enabled: boolean;
  signed?: boolean;
};

export default function CrmConfig() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CrmRow | null>(null);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [form] = Form.useForm();
  const [webhookForm] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['crm-config'], queryFn: () => leadApi.listCrm() });
  const list = (data as CrmRow[]) || [];
  const { data: webhookData, isLoading: webhookLoading } = useQuery({ queryKey: ['webhooks'], queryFn: leadApi.webhooks });
  const webhooks = (webhookData as WebhookRow[]) || [];

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const payload = {
        provider: values.provider,
        enabled: values.enabled,
        config: { token: values.token, apiUrl: values.apiUrl },
      };
      return editing ? leadApi.updateCrmConfig(editing.id, payload) : leadApi.createCrmConfig(payload);
    },
    onSuccess: () => {
      message.success(editing ? 'CRM 配置已更新' : 'CRM 配置已保存');
      setOpen(false);
      setEditing(null);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['crm-config'] });
    },
  });
  const createWebhook = useMutation({
    mutationFn: (values: { url: string; events?: string[] }) => leadApi.createWebhook(values),
    onSuccess: (result) => {
      const secret = (result as { secret?: string }).secret;
      setWebhookOpen(false);
      webhookForm.resetFields();
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      modal.success({
        title: 'Webhook 已创建',
        content: secret ? `签名密钥只显示一次，请立即保存：${secret}` : 'Webhook 已创建。',
        width: 620,
      });
    },
  });
  const removeCrm = useMutation({
    mutationFn: leadApi.removeCrmConfig,
    onSuccess: () => {
      message.success('CRM 配置已删除');
      qc.invalidateQueries({ queryKey: ['crm-config'] });
    },
  });
  const toggleWebhook = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => leadApi.updateWebhook(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const removeWebhook = useMutation({
    mutationFn: leadApi.removeWebhook,
    onSuccess: () => {
      message.success('Webhook 已删除');
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
  const syncAllCrm = useMutation({
    mutationFn: leadApi.syncAllCrm,
    onSuccess: (result) => {
      const value = result as { total: number; synced: number };
      if (value.total === 0) {
        message.info('当前没有需要同步的未结束线索');
      } else if (value.synced === value.total) {
        message.success(`CRM 同步完成：${value.synced}/${value.total}`);
      } else {
        message.warning(`CRM 同步完成：成功 ${value.synced}/${value.total}，请在线索池查看失败原因`);
      }
    },
  });
  const testNotifications = useMutation({
    mutationFn: leadApi.testNotifications,
    onSuccess: (result) => {
      const value = result as Record<'wecom' | 'sms' | 'email', { sent: boolean }>;
      const sent = [
        value.wecom?.sent && '企业微信',
        value.sms?.sent && '短信',
        value.email?.sent && '邮件',
      ].filter(Boolean);
      if (sent.length > 0) {
        message.success(`测试通知已送达：${sent.join('、')}`);
      } else {
        message.warning('没有通道确认送达，请检查服务配置与后端日志');
      }
    },
  });

  const openCrm = (row?: CrmRow) => {
    setEditing(row || null);
    form.setFieldsValue(row ? { provider: row.provider, enabled: row.enabled } : { enabled: true });
    setOpen(true);
  };

  const columns = [
    { title: '服务商', dataIndex: 'provider', render: (provider: string) => <Tag color="blue">{provider}</Tag> },
    { title: '启用', dataIndex: 'enabled', render: (enabled: boolean) => (enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    { title: '配置状态', dataIndex: 'configured', render: (configured: boolean) => configured ? <Tag color="success">已配置（密钥已加密）</Tag> : <Tag color="warning">未配置</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', render: (time: string) => (time ? new Date(time).toLocaleString('zh-CN') : '-') },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: CrmRow) => (
        <>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openCrm(row)}>编辑</Button>
          <Popconfirm title="确定删除此 CRM 配置？" onConfirm={() => removeCrm.mutate(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  const webhookColumns = [
    { title: '接收地址', dataIndex: 'url', ellipsis: true },
    {
      title: '事件',
      dataIndex: 'events',
      render: (value: string) => {
        try {
          const events = JSON.parse(value || '[]') as string[];
          return events.length ? events.map((event) => <Tag key={event}>{event}</Tag>) : <Tag>全部事件</Tag>;
        } catch {
          return '-';
        }
      },
    },
    { title: '签名', dataIndex: 'signed', render: (signed: boolean) => signed ? <Tag color="success">已启用</Tag> : <Tag color="warning">未启用</Tag> },
    {
      title: '启用',
      dataIndex: 'enabled',
      render: (enabled: boolean, row: WebhookRow) => <Switch checked={enabled} loading={toggleWebhook.isPending} onChange={(checked) => toggleWebhook.mutate({ id: row.id, enabled: checked })} />,
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: WebhookRow) => (
        <Popconfirm title="确定删除此 Webhook？" onConfirm={() => removeWebhook.mutate(row.id)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <PageContainer title="CRM 与 Webhook">
      <Card
        title="CRM 对接"
        extra={(
          <Space>
            <Button icon={<SyncOutlined />} loading={syncAllCrm.isPending} onClick={() => syncAllCrm.mutate()}>同步未结束线索</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCrm()}>新增对接</Button>
          </Space>
        )}
        style={{ marginBottom: 16 }}
      >
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="这里填写企业已部署的 MVMS CRM 合规网关，不是 CRM 厂商原始 OpenAPI 地址"
          description="编辑配置时出于安全原因不会回显 Token，需要重新输入网关地址和 Token。"
        />
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Card title="线索 Webhook" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setWebhookOpen(true)}>新增 Webhook</Button>} style={{ marginBottom: 16 }}>
        <Table rowKey="id" loading={webhookLoading} columns={webhookColumns} dataSource={webhooks} pagination={false} />
      </Card>
      <Card
        title="企微 / 短信 / 邮件通知"
        extra={<Button icon={<SendOutlined />} loading={testNotifications.isPending} onClick={() => testNotifications.mutate()}>发送测试通知</Button>}
      >
        <Alert
          showIcon
          type="info"
          message="测试仅向系统环境中已配置的接收人发送，不使用真实客户资料"
          description="返回结果以各服务商明确确认送达为准；未配置、网络失败或响应含糊的通道都会显示为未送达。"
        />
      </Card>

      <Modal title={editing ? '编辑 CRM 对接' : '新增 CRM 对接'} open={open} onCancel={() => { setOpen(false); setEditing(null); form.resetFields(); }} onOk={() => form.submit()} confirmLoading={saveMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(values) => saveMut.mutate(values)}>
          <Form.Item name="provider" label="CRM 服务商" rules={[{ required: true }]}>
            <Select options={[
              { value: 'fenxi', label: '纷享销客' },
              { value: 'xiaoshouyi', label: '销售易' },
              { value: 'hongquan', label: '红圈' },
            ]} />
          </Form.Item>
          <Form.Item name="apiUrl" label="MVMS CRM 网关地址" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://crm-gateway.example.com/mvms/leads" /></Form.Item>
          <Form.Item name="token" label="Access Token" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title="新增线索 Webhook" open={webhookOpen} onCancel={() => { setWebhookOpen(false); webhookForm.resetFields(); }} onOk={() => webhookForm.submit()} confirmLoading={createWebhook.isPending}>
        <Form form={webhookForm} layout="vertical" initialValues={{ events: ['lead.created'] }} onFinish={(values) => createWebhook.mutate(values)}>
          <Form.Item name="url" label="HTTPS 接收地址" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://hooks.example.com/mvms/leads" /></Form.Item>
          <Form.Item name="events" label="订阅事件">
            <Select mode="multiple" options={[{ value: 'lead.created', label: '线索创建（lead.created）' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
