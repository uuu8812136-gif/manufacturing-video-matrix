import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, Button, App, Tag, Steps, Input, Form, Alert, Descriptions } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { authApi, userApi } from '@/api';
import { useAuthStore } from '@/store/auth';
import PageContainer from '@/components/PageContainer';

export default function Security() {
  const { message, modal } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [otpauth, setOtpauth] = useState<string>();
  const [form] = Form.useForm();

  const { data: profile, refetch: refetchProfile } = useQuery({ queryKey: ['profile'], queryFn: userApi.profile });
  const mfaEnabled = (profile as { mfaEnabled?: boolean })?.mfaEnabled;

  const setupMut = useMutation({ mutationFn: authApi.mfaSetup, onSuccess: (r) => { setOtpauth((r as { otpauth: string }).otpauth); message.success('已生成密钥，请用验证器扫码/输入'); } });
  const enableMut = useMutation({
    mutationFn: (code: string) => authApi.mfaEnable(code),
    onSuccess: async () => {
      message.success('MFA 已开启');
      setOtpauth(undefined);
      form.resetFields();
      if (user) setUser({ ...user, mfaEnabled: true });
      await refetchProfile();
    },
  });
  const disableMut = useMutation({
    mutationFn: authApi.mfaDisable,
    onSuccess: async () => {
      message.success('MFA 已关闭');
      if (user) setUser({ ...user, mfaEnabled: false });
      await refetchProfile();
    },
  });

  return (
    <PageContainer title="安全设置">
      <Card title={<><SafetyCertificateOutlined /> 多因素认证 (MFA)</>} style={{ marginBottom: 16 }}>
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message="MFA 多因素认证提升账号安全（SR-003）" />
        <Descriptions column={1}>
          <Descriptions.Item label="当前状态">{mfaEnabled ? <Tag color="success">已开启</Tag> : <Tag color="warning">未开启</Tag>}</Descriptions.Item>
          <Descriptions.Item label="当前账号">{user?.name} ({user?.phone})</Descriptions.Item>
        </Descriptions>
        {mfaEnabled ? (
          <Button
            danger
            loading={disableMut.isPending}
            onClick={() => modal.confirm({
              title: '确认关闭 MFA？',
              content: '关闭后账号仅依赖密码登录，安全性会降低。',
              okText: '确认关闭',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => disableMut.mutateAsync(),
            })}
          >
            关闭 MFA
          </Button>
        ) : (
          <>
            <Button type="primary" loading={setupMut.isPending} onClick={() => setupMut.mutate()} style={{ marginRight: 8 }}>获取 MFA 密钥</Button>
            {otpauth && (
              <div style={{ marginTop: 16 }}>
                <p>请将以下密钥输入到验证器 App（如 Google Authenticator）：</p>
                <Card size="small" style={{ wordBreak: 'break-all', marginBottom: 16 }}>{otpauth}</Card>
                <Form form={form} layout="inline" onFinish={(v) => enableMut.mutate(v.code)}>
                  <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]}><Input placeholder="6位动态验证码" /></Form.Item>
                  <Button type="primary" htmlType="submit" loading={enableMut.isPending}>确认开启</Button>
                </Form>
              </div>
            )}
          </>
        )}
      </Card>
      <Card title="安全策略">
        <Steps size="small" current={2} items={[
          { title: '账号授权加密', description: 'AES-256 加密存储 (SR-001)' },
          { title: 'HTTPS/TLS 1.3', description: '传输加密 (SR-002)' },
          { title: 'MFA 多因素认证', description: '动态验证码 (SR-003)' },
          { title: '操作审计日志', description: '全量记录 (SR-004)' },
        ]} />
      </Card>
    </PageContainer>
  );
}
