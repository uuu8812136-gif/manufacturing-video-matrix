import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, Upload, Space, Popconfirm } from 'antd';
import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { aiApi, assetApi } from '@/api';
import PageContainer from '@/components/PageContainer';

export default function Materials() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['materials', page], queryFn: () => aiApi.materials({ page, pageSize: 10 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => aiApi.createMaterial(v),
    onSuccess: () => { message.success('素材已保存'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['materials'] }); },
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => aiApi.removeMaterial(id),
    onSuccess: () => { message.success('素材已删除'); qc.invalidateQueries({ queryKey: ['materials'] }); },
  });
  const uploadMut = useMutation({
    mutationFn: assetApi.upload,
    onSuccess: (result) => {
      form.setFieldValue('url', result.url);
      if (!form.getFieldValue('name')) form.setFieldValue('name', result.name);
      message.success('文件上传成功');
    },
    onSettled: () => setUploading(false),
  });

  const columns = [
    { title: '素材名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag>{({ video_template: '视频模板', music: '音乐', image: '图片', video: '视频' }[t] || t)}</Tag> },
    { title: '分类', dataIndex: 'category', render: (c: string) => ({ factory: '工厂场景', product: '产品展示', industry: '行业通用', brand: '品牌' }[c] || c || '-') },
    { title: '链接', dataIndex: 'url', ellipsis: true, render: (url: string) => <a href={url} target="_blank" rel="noreferrer">查看素材</a> },
    { title: '操作', width: 90, render: (_: unknown, row: Record<string, unknown>) => <Popconfirm title="确定删除该素材？" onConfirm={() => removeMut.mutate(row.id as string)}><Button danger size="small" icon={<DeleteOutlined />}>删除</Button></Popconfirm> },
  ];

  return (
    <PageContainer title="素材库">
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>上传素材</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
      </Card>
      <Modal
        title="上传素材"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending || uploadMut.isPending}
        okButtonProps={{ disabled: uploadMut.isPending }}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
          <Form.Item name="name" label="素材名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'video_template', label: '视频模板' }, { value: 'music', label: '音乐' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }]} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select options={[{ value: 'factory', label: '工厂场景' }, { value: 'product', label: '产品展示' }, { value: 'industry', label: '行业通用' }, { value: 'brand', label: '品牌' }]} />
          </Form.Item>
          <Form.Item label="素材文件/链接" required>
            <Space.Compact block>
              <Form.Item name="url" noStyle rules={[{ required: true, message: '请上传文件或填写素材链接' }]}>
                <Input placeholder="上传文件后自动填充，或填写 HTTPS 地址" />
              </Form.Item>
              <Upload showUploadList={false} beforeUpload={(file) => { setUploading(true); uploadMut.mutate(file); return false; }}>
                <Button icon={<UploadOutlined />} loading={uploading}>上传文件</Button>
              </Upload>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
