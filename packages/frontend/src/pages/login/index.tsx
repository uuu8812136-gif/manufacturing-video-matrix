import { useState } from 'react';
import { Alert, Form, Input, Button, message } from 'antd';
import { MobileOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authApi } from '@/api';
import { useAuthStore } from '@/store/auth';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [form] = Form.useForm();
  const [mfaForm] = Form.useForm();

  const onLogin = async (values: { phone: string; password: string }) => {
    setLoginError('');
    setLoading(true);
    try {
      const res = (await authApi.login(values)) as {
        mfaRequired?: boolean;
        mfaToken?: string;
        accessToken?: string;
        refreshToken?: string;
        user?: unknown;
      };
      if (res.mfaRequired && res.mfaToken) {
        setMfaToken(res.mfaToken);
        setMfaRequired(true);
        message.info('请输入动态验证码');
      } else if (res.accessToken) {
        setAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken! }, res.user as never);
        message.success('登录成功');
        navigate('/dashboard');
      }
    } catch (error) {
      const requestError = error as { response?: { data?: { message?: string } }; message?: string };
      setLoginError(requestError.response?.data?.message || requestError.message || '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const onMfa = async (values: { code: string }) => {
    setLoading(true);
    try {
      const res = (await authApi.mfaVerify({ mfaToken, code: values.code })) as {
        accessToken: string;
        refreshToken: string;
        user: unknown;
      };
      setAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken }, res.user as never);
      message.success('登录成功');
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
        background: 'linear-gradient(135deg, #0f172a 0%, #1a2b4a 50%, #1e3a5f 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 装饰光晕 */}
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-30%',
          left: '-10%',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* 左侧品牌区 */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        style={{
          flex: '1.2',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 8%',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 20,
              boxShadow: '0 8px 24px rgba(245, 158, 11, 0.4)',
            }}
          >
            M
          </div>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: '0.02em' }}>
            MVMS
          </span>
        </div>

        <h1
          style={{
            color: '#fff',
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            margin: 0,
            marginBottom: 20,
          }}
        >
          制造业短视频矩阵
          <br />
          智能分发系统
        </h1>
        <p
          style={{
            color: 'rgba(255, 255, 255, 0.65)',
            fontSize: 17,
            lineHeight: 1.6,
            maxWidth: 440,
            margin: 0,
          }}
        >
          从内容到线索，一站式矩阵增长引擎。
          <br />
          AI 创作 · 多平台分发 · GEO 获客 · 线索闭环
        </p>

      </motion.div>

      {/* 右侧登录卡 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
        style={{
          flex: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 5%',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '40px 32px',
            borderRadius: 16,
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.3)',
          }}
        >
          <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 4 }}>
            {mfaRequired ? '两步验证' : '欢迎回来'}
          </h2>
          <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 13, margin: 0, marginBottom: 28 }}>
            {mfaRequired ? '请输入动态验证码完成登录' : '登录以进入工作台'}
          </p>

          {!mfaRequired ? (
            <Form form={form} onFinish={onLogin} size="large" requiredMark={false}>
              {loginError && (
                <Alert
                  type="error"
                  showIcon
                  message={loginError}
                  closable
                  onClose={() => setLoginError('')}
                  style={{ marginBottom: 16 }}
                />
              )}
              <Form.Item name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
                <Input
                  prefix={<MobileOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  placeholder="手机号"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    height: 46,
                  }}
                />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password
                  prefix={<LockOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  placeholder="密码"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    height: 46,
                  }}
                />
              </Form.Item>
              <Button
                htmlType="submit"
                block
                loading={loading}
                style={{
                  height: 46,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  boxShadow: '0 8px 24px rgba(245, 158, 11, 0.3)',
                }}
              >
                登录
              </Button>
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Link to="/register" style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 13 }}>
                  还没有账号？立即注册
                </Link>
              </div>
            </Form>
          ) : (
            <Form form={mfaForm} onFinish={onMfa} size="large">
              <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]}>
                <Input
                  prefix={<SafetyOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  placeholder="MFA 动态验证码"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    height: 46,
                  }}
                />
              </Form.Item>
              <Button
                htmlType="submit"
                block
                loading={loading}
                style={{
                  height: 46,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  boxShadow: '0 8px 24px rgba(245, 158, 11, 0.3)',
                }}
              >
                验证并登录
              </Button>
              <Button type="link" block onClick={() => setMfaRequired(false)} style={{ color: 'rgba(255,255,255,0.5)' }}>
                返回
              </Button>
            </Form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
