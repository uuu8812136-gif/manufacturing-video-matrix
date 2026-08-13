import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, Form, Input, Button, App, Typography, Space, Tag } from 'antd';
import { aiApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { Paragraph } = Typography;

export default function Extract() {
  const { message } = App.useApp();
  const [result, setResult] = useState<{ text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (v: { videoUrl: string }) => aiApi.extractText(v),
    onSuccess: (r) => { setResult(r as { text: string }); message.success('文案提取完成'); },
  });

  return (
    <PageContainer title="视频文案提取">
      <Card>
        <Form layout="vertical" onFinish={(v) => mut.mutate(v)} style={{ maxWidth: 640 }}>
          <Form.Item name="videoUrl" label="视频 URL" rules={[{ required: true }]}>
            <Input placeholder="https://cdn.example.com/video.mp4" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mut.isPending}>提取文案</Button>
        </Form>
        {result && (
          <Card type="inner" title="提取结果" style={{ marginTop: 16 }}>
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{result.text}</Paragraph>
            <Space>
              <Tag color="blue">Whisper 模型</Tag>
              <Tag>STT 服务</Tag>
            </Space>
          </Card>
        )}
      </Card>
    </PageContainer>
  );
}
