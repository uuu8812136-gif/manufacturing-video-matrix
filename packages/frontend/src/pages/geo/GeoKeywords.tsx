import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Table, Button, Modal, Form, Input, Select, Tag, App, Space, Popconfirm } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { geoApi } from '@/api';
import PageContainer from '@/components/PageContainer';

export default function GeoKeywords() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [citationKeyword, setCitationKeyword] = useState<Record<string, unknown> | null>(null);
  const [citationPlatform, setCitationPlatform] = useState('deepseek');
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['geo-keywords', page], queryFn: () => geoApi.keywords({ page, pageSize: 10 }) });
  const capabilitiesQuery = useQuery({ queryKey: ['geo-capabilities'], queryFn: geoApi.capabilities });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;
  const capabilities = (capabilitiesQuery.data as { mode?: string; engines?: Array<{ engine: string; supported: boolean; reason?: string }> })?.engines || [];
  const unsupported = capabilities.filter((item) => !item.supported);

  const addMut = useMutation({ mutationFn: (v: { word: string; type: string; targetDomain?: string; targetBrand?: string }) => geoApi.createKeyword(v), onSuccess: () => { message.success('已添加'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['geo-keywords'] }); } });
  const checkMut = useMutation({ mutationFn: (id: string) => geoApi.check(id), onSuccess: () => { message.success('排名监测完成'); qc.invalidateQueries({ queryKey: ['geo-tracking'] }); } });
  const citationMut = useMutation({ mutationFn: ({ id, platform }: { id: string; platform: string }) => geoApi.aiCitation(id, platform), onSuccess: () => { message.success('AI 引用检测完成'); setCitationKeyword(null); qc.invalidateQueries({ queryKey: ['geo-tracking'] }); } });
  const removeMut = useMutation({ mutationFn: geoApi.removeKeyword, onSuccess: () => { message.success('关键词已删除'); qc.invalidateQueries({ queryKey: ['geo-keywords'] }); } });

  const columns = [
    { title: '关键词', dataIndex: 'word' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag>{({ product: '产品词', industry: '行业词', region: '地域词' }[t] || t)}</Tag> },
    { title: '目标品牌', dataIndex: 'targetBrand', render: (value: string) => value || '-' },
    { title: '目标域名', dataIndex: 'targetDomain', render: (value: string) => value || '-' },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={s === 'tracking' ? 'processing' : 'default'}>{s === 'tracking' ? '监测中' : s}</Tag> },
    { title: '操作', width: 280, render: (_: unknown, r: Record<string, unknown>) => <Space><Button size="small" loading={checkMut.isPending} onClick={() => checkMut.mutate(r.id as string)}>监测排名</Button><Button size="small" onClick={() => setCitationKeyword(r)}>AI 引用</Button><Popconfirm title="确定删除关键词及历史监测记录？" onConfirm={() => removeMut.mutate(r.id as string)}><Button danger size="small" icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> },
  ];

  return (
    <PageContainer title="品牌关键词库">
      <Card>
        {unsupported.length > 0 && (
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 16 }}
            message={`当前真实排名服务支持：${capabilities.filter((item) => item.supported).map((item) => item.engine).join('、') || '无'}`}
            description={unsupported.map((item) => `${item.engine}：${item.reason || '当前服务不支持'}`).join('；')}
          />
        )}
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>添加关键词</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} scroll={{ x: 980 }} pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
      </Card>
      <Modal title="添加关键词" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={addMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => addMut.mutate(v)}>
          <Form.Item name="word" label="关键词" rules={[{ required: true }]}><Input placeholder="如：断桥铝门窗" /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'product', label: '产品词' }, { value: 'industry', label: '行业词' }, { value: 'region', label: '地域词' }]} />
          </Form.Item>
          <Form.Item
            name="targetDomain"
            label="目标官网域名"
            dependencies={['targetBrand']}
            rules={[
              { max: 253 },
              { pattern: /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:[a-zA-Z]{2,63}|xn--[a-zA-Z0-9-]{2,59})$/, message: '请填写 example.com 形式的公网域名，不含协议和路径' },
              ({ getFieldValue }) => ({
                validator: (_, value) => value || getFieldValue('targetBrand')
                  ? Promise.resolve()
                  : Promise.reject(new Error('目标官网域名和目标品牌至少填写一项')),
              }),
            ]}
          >
            <Input placeholder="如：example.com（无需填路径）" />
          </Form.Item>
          <Form.Item name="targetBrand" label="目标品牌" rules={[{ min: 2 }, { max: 100 }, { pattern: /^(?!.*(?:https?:\/\/|[\r\n\t]))(?=(?:.*[\p{L}\p{N}]){2})[\p{L}\p{N}\p{M}\s·&＋+（）()_.\-'’]+$/u, message: '至少包含两个文字或数字，且不能填写网址' }]}>
            <Input placeholder="如：星河门窗" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={`AI 平台引用检测：${citationKeyword?.word || ''}`} open={!!citationKeyword} onCancel={() => setCitationKeyword(null)} onOk={() => citationKeyword && citationMut.mutate({ id: citationKeyword.id as string, platform: citationPlatform })} confirmLoading={citationMut.isPending}>
        <Select value={citationPlatform} style={{ width: '100%' }} onChange={setCitationPlatform} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'doubao', label: '豆包' }, { value: 'ernie', label: '文心一言' }, { value: 'qwen', label: '通义千问' }]} />
      </Modal>
    </PageContainer>
  );
}
