import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Form, Input, Button, App, Typography, Spin, Result } from 'antd';
import { leadApi } from '@/api';

const { Title, Paragraph } = Typography;

export default function LeadForm() {
  const { formId } = useParams<{ formId: string }>();
  const { message } = App.useApp();
  const [formConfig, setFormConfig] = useState<{ name: string; fields: { name: string; label: string; type: string; required?: boolean }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const f = (await leadApi.getForm(formId!)) as { id: string; name: string; fields: string };
        if (!f) { setNotFound(true); return; }
        setFormConfig({ name: f.name, fields: JSON.parse(f.fields) });
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [formId]);

  const onFinish = async (values: Record<string, string>) => {
    setSubmitting(true);
    try {
      const params = new URLSearchParams(window.location.search);
      await leadApi.submitLead({
        formId: formId!,
        data: values,
        sourcePlatform: params.get('source_platform') || undefined,
        sourceAccountId: params.get('account_id') || undefined,
        sourceContentId: params.get('content_id') || undefined,
        sourceContentTitle: params.get('content_title') || undefined,
      });
      message.success('提交成功，我们会尽快与您联系！');
      form.resetFields();
    } catch {
      message.error('提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (notFound) return <Result status="404" title="表单不存在" />;
  if (!formConfig) return null;

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px' }}>
      <Card>
        <Title level={3} style={{ textAlign: 'center' }}>{formConfig.name}</Title>
        <Paragraph type="secondary" style={{ textAlign: 'center' }}>请填写以下信息，专业顾问将为您服务</Paragraph>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="website" style={{ display: 'none' }}><Input tabIndex={-1} autoComplete="off" /></Form.Item>
          {formConfig.fields.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label} rules={f.required ? [{ required: true, message: `请输入${f.label}` }] : []}>
              {f.type === 'textarea' ? <Input.TextArea rows={3} /> : <Input type={['tel', 'email', 'number'].includes(f.type) ? f.type : 'text'} />}
            </Form.Item>
          ))}
          <Button type="primary" htmlType="submit" block loading={submitting}>提交</Button>
        </Form>
      </Card>
    </div>
  );
}
