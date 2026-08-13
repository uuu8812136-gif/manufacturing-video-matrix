import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, Popconfirm } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { userApi } from '@/api';
import { ROLE_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';
import { useState } from 'react';

export default function Members() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['members'], queryFn: userApi.members });
  const list = (data as Record<string, unknown>[]) || [];

  const inviteMut = useMutation({ mutationFn: (v: { phone: string; name: string; password: string; role: string }) => userApi.invite(v), onSuccess: () => { message.success('已邀请'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['members'] }); } });
  const roleMut = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => userApi.updateRole(id, role), onSuccess: () => { message.success('已更新'); qc.invalidateQueries({ queryKey: ['members'] }); } });
  const removeMut = useMutation({ mutationFn: userApi.removeMember, onSuccess: () => { message.success('成员已移除'); qc.invalidateQueries({ queryKey: ['members'] }); } });

  const columns = [
    { title: '姓名', dataIndex: 'name' },
    { title: '手机号', dataIndex: 'phone' },
    { title: '角色', dataIndex: 'role', render: (r: string, row: Record<string, unknown>) => (
      <Select size="small" defaultValue={r} style={{ width: 130 }} options={Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => roleMut.mutate({ id: row.id as string, role: v })} />
    ) },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={s === 'active' ? 'success' : 'default'}>{s === 'active' ? '正常' : '禁用'}</Tag> },
    { title: '最后登录', dataIndex: 'lastLoginAt', render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
    { title: '操作', width: 100, render: (_: unknown, row: Record<string, unknown>) => <Popconfirm title="确定移除该成员？" onConfirm={() => removeMut.mutate(row.id as string)}><Button size="small" danger>移除</Button></Popconfirm> },
  ];

  return (
    <PageContainer title="团队成员">
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>邀请成员</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Modal title="邀请成员" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={inviteMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => inviteMut.mutate(v)}>
          <Form.Item name="phone" label="手机号" rules={[{ required: true }, { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]}><Input /></Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true }, { min: 8, message: '至少8位' }, { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '必须同时包含字母和数字' }]}><Input.Password /></Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} initialValue="content_editor">
            <Select options={Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
