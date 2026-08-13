import { Card, Form, Input, Button, message, Typography } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '@/api';
import { useAuthStore } from '@/store/auth';
import { useState } from 'react';

const { Title, Text } = Typography;

export default function Register() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { phone: string; password: string; name: string; teamName?: string; inviteCode?: string }) => {
    setLoading(true);
    try {
      const res = (await authApi.register(values)) as { accessToken: string; refreshToken: string; user: unknown };
      setAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken }, res.user as never);
      message.success('注册成功');
      navigate('/dashboard');
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a1929 0%, #1e3a5f 50%, #1677ff 100%)',
      }}
    >
      <Card style={{ width: 420, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }} bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>企业注册</Title>
          <Text type="secondary">开通制造业短视频矩阵智能分发系统</Text>
        </div>
        <Form onFinish={onFinish} size="large">
          <Form.Item name="phone" rules={[{ required: true, message: '请输入手机号' }, { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]}>
            <Input placeholder="手机号" />
          </Form.Item>
          <Form.Item name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item name="teamName">
            <Input placeholder="企业名称（选填）" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '密码至少8位' }, { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '密码必须同时包含字母和数字' }]}>
            <Input.Password placeholder="设置密码" />
          </Form.Item>
          <Form.Item name="inviteCode">
            <Input placeholder="渠道邀请码（选填）" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>注册并登录</Button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Link to="/login">已有账号？返回登录</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}
