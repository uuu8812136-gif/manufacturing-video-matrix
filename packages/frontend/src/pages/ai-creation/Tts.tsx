import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, Form, Input, Button, App, AutoComplete, Slider, Typography, Row, Col, Statistic } from 'antd';
import { aiApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;
const { Paragraph } = Typography;

const VOICES = [
  { value: 'alloy', label: 'alloy（通用）' },
  { value: 'coral', label: 'coral（自然）' },
  { value: 'sage', label: 'sage（沉稳）' },
  { value: 'verse', label: 'verse（清晰）' },
];

export default function Tts() {
  const { message } = App.useApp();
  const [result, setResult] = useState<{ url: string; duration: number } | null>(null);

  const mut = useMutation({
    mutationFn: (v: { text: string; voice?: string; rate?: number; pitch?: number }) => aiApi.tts(v),
    onSuccess: (r) => { setResult(r as { url: string; duration: number }); message.success('语音合成完成'); },
  });

  return (
    <PageContainer title="语音合成（TTS）">
      <Card>
        <Form
          layout="vertical"
          onFinish={(v) => mut.mutate({ ...v, rate: v.rate ? v.rate / 100 : undefined, pitch: v.pitch ? v.pitch / 100 : undefined })}
          style={{ maxWidth: 640 }}
          initialValues={{ voice: 'alloy', rate: 0, pitch: 0 }}
        >
          <Form.Item name="text" label="配音文案" rules={[{ required: true }]}>
            <TextArea rows={5} placeholder="输入要合成语音的文案" />
          </Form.Item>
          <Form.Item name="voice" label="音色"><AutoComplete options={VOICES} placeholder="可选预置音色或输入服务商 voice ID" /></Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="rate" label="语速调节（%）"><Slider min={-50} max={50} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pitch" label="音调调节（%）"><Slider min={-50} max={50} /></Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={mut.isPending}>合成语音</Button>
        </Form>
        {result && (
          <Card type="inner" title="合成结果" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={8}><Statistic title="时长(秒)" value={result.duration} /></Col>
              <Col span={16}>
                <Paragraph>音频地址：<a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></Paragraph>
                {result.url.startsWith('http') && <audio controls src={result.url} style={{ width: '100%' }} />}
              </Col>
            </Row>
          </Card>
        )}
      </Card>
    </PageContainer>
  );
}
