import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, Form, Input, Button, App, Select, Space, Typography, Tag, InputNumber, Row, Col } from 'antd';
import { aiApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

export default function Mixcut() {
  const { message } = App.useApp();
  const [clips, setClips] = useState<string[]>([]);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [toolOperation, setToolOperation] = useState<'gif' | 'speed' | 'crop'>('gif');
  const [toolResult, setToolResult] = useState<{ url: string } | null>(null);
  const [adaptResult, setAdaptResult] = useState<{ url: string } | null>(null);

  const mut = useMutation({
    mutationFn: (v: { clips: string[]; watermark?: string; ratio?: string }) => aiApi.mixcut(v),
    onSuccess: (r) => { setResult(r as { url: string }); message.success('混剪完成'); },
  });
  const toolMut = useMutation({
    mutationFn: aiApi.videoTool,
    onSuccess: (value) => { setToolResult(value as { url: string }); message.success('视频处理完成'); },
  });
  const adaptMut = useMutation({
    mutationFn: aiApi.adaptRatio,
    onSuccess: (value) => { setAdaptResult(value as { url: string }); message.success('比例适配完成'); },
  });

  return (
    <PageContainer title="视频混剪">
      <Card>
        <Form layout="vertical" onFinish={(v) => mut.mutate({ ...v, clips })} style={{ maxWidth: 640 }}>
          <Form.Item label="素材视频 URL（多个用回车分隔）" required>
            <TextArea
              rows={4}
              placeholder="https://cdn.example.com/clip1.mp4&#10;https://cdn.example.com/clip2.mp4"
              onChange={(e) => setClips(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            />
            <Space wrap style={{ marginTop: 8 }}>
              {clips.map((c, i) => <Tag key={i} color="blue">片段{i + 1}</Tag>)}
            </Space>
          </Form.Item>
          <Form.Item name="watermark" label="品牌水印图片 URL（选填）"><Input placeholder="透明 PNG/JPG，可先上传到素材库" /></Form.Item>
          <Form.Item name="ratio" label="输出比例" initialValue="9:16">
            <Select options={[{ value: '9:16', label: '9:16 竖屏' }, { value: '16:9', label: '16:9 横屏' }, { value: '1:1', label: '1:1 方形' }, { value: '3:4', label: '3:4 图文竖版' }]} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mut.isPending} disabled={clips.length < 2}>开始混剪</Button>
        </Form>
        {result && (
          <Card type="inner" title="混剪结果" style={{ marginTop: 16 }}>
            <Paragraph>输出视频：<a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></Paragraph>
            <Text type="secondary">输出已保存到对象存储，可直接进入内容库或发布流程。</Text>
          </Card>
        )}
      </Card>
      <Card title="视频工具箱" style={{ marginTop: 16 }}>
        <Form layout="vertical" style={{ maxWidth: 720 }} initialValues={{ operation: 'gif', speed: 1, start: 0, duration: 10 }} onFinish={(values) => toolMut.mutate(values)}>
          <Form.Item name="videoUrl" label="视频 URL" rules={[{ required: true }]}><Input placeholder="可填写素材库中的稳定视频地址" /></Form.Item>
          <Form.Item name="operation" label="处理操作" rules={[{ required: true }]}>
            <Select onChange={setToolOperation} options={[{ value: 'gif', label: '视频转 GIF' }, { value: 'speed', label: '视频变速' }, { value: 'crop', label: '按时间裁剪' }]} />
          </Form.Item>
          {toolOperation === 'speed' && <Form.Item name="speed" label="播放速度（0.25-4 倍）"><InputNumber min={0.25} max={4} step={0.25} /></Form.Item>}
          {toolOperation === 'crop' && <Row gutter={12}>
            <Col span={12}><Form.Item name="start" label="开始秒数"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="duration" label="截取时长（秒）"><InputNumber min={0.1} max={3600} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>}
          <Button type="primary" htmlType="submit" loading={toolMut.isPending}>开始处理</Button>
        </Form>
        {toolResult && <Card size="small" type="inner" title="处理结果" style={{ marginTop: 16 }}><a href={toolResult.url} target="_blank" rel="noreferrer">{toolResult.url}</a></Card>}
      </Card>
      <Card title="单视频比例适配" style={{ marginTop: 16 }}>
        <Form
          layout="vertical"
          style={{ maxWidth: 720 }}
          initialValues={{ ratio: '9:16' }}
          onFinish={(values) => adaptMut.mutate(values)}
        >
          <Form.Item name="videoUrl" label="原视频 URL" rules={[{ required: true }]}>
            <Input placeholder="填写素材库或内容库中的视频地址" />
          </Form.Item>
          <Form.Item name="ratio" label="目标比例" rules={[{ required: true }]}>
            <Select options={[
              { value: '9:16', label: '9:16 竖屏' },
              { value: '16:9', label: '16:9 横屏' },
              { value: '1:1', label: '1:1 方形' },
              { value: '3:4', label: '3:4 图文竖版' },
            ]} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={adaptMut.isPending}>开始适配</Button>
        </Form>
        {adaptResult && <Card size="small" type="inner" title="适配结果" style={{ marginTop: 16 }}><a href={adaptResult.url} target="_blank" rel="noreferrer">{adaptResult.url}</a></Card>}
      </Card>
    </PageContainer>
  );
}
