import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, App, Space, Popconfirm, Upload } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { assetApi, contentApi } from '@/api';
import PageContainer from '@/components/PageContainer';

type ContentRow = Record<string, unknown> & { id: string; title: string };

export default function Contents() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContentRow | null>(null);
  const [uploading, setUploading] = useState<'videoUrl' | 'coverUrl' | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['contents', page], queryFn: () => contentApi.list({ page, pageSize: 10 }) });
  const list = ((data as { list?: ContentRow[] })?.list) || [];
  const total = (data as { total?: number })?.total || 0;

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => editing ? contentApi.update(editing.id, v) : contentApi.create(v),
    onSuccess: () => {
      message.success(editing ? '内容已更新' : '内容已创建');
      closeModal();
      qc.invalidateQueries({ queryKey: ['contents'] });
    },
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => contentApi.remove(id),
    onSuccess: () => { message.success('内容已删除'); qc.invalidateQueries({ queryKey: ['contents'] }); },
  });
  const importWordMut = useMutation({
    mutationFn: contentApi.importWord,
    onSuccess: () => { message.success('Word 文档已导入内容库'); qc.invalidateQueries({ queryKey: ['contents'] }); },
  });
  const uploadMut = useMutation({
    mutationFn: ({ file }: { file: File; field: 'videoUrl' | 'coverUrl' }) => assetApi.upload(file),
    onSuccess: (result, variables) => {
      form.setFieldsValue({ [variables.field]: result.url });
      message.success('文件上传成功');
    },
    onSettled: () => setUploading(null),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'video', source: 'manual', tags: [] });
    setOpen(true);
  };
  const openEdit = (row: ContentRow) => {
    setEditing(row);
    form.setFieldsValue({ ...row, tags: Array.isArray(row.tags) ? row.tags : [] });
    setOpen(true);
  };
  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setUploading(null);
    form.resetFields();
  };
  const upload = (field: 'videoUrl' | 'coverUrl', file: File) => {
    setUploading(field);
    uploadMut.mutate({ file, field });
    return false;
  };

  const columns = [
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'type', width: 80, render: (t: string) => ({ video: '视频', image_text: '图文', dynamic: '动态' }[t] || t) },
    { title: '来源', dataIndex: 'source', width: 90, render: (s: string) => <Tag>{({ manual: '手动', ai: 'AI', digital_human: '数字人', recreation: '二创', batch_import: '批量' }[s] || s)}</Tag> },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'published' ? 'green' : 'default'}>{value || 'draft'}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', width: 150, render: (_: unknown, row: ContentRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title="确定删除这条内容？" onConfirm={() => removeMut.mutate(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} loading={removeMut.isPending}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="内容库">
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建内容</Button>
          <Upload accept=".docx" showUploadList={false} beforeUpload={(file) => { importWordMut.mutate(file); return false; }}><Button icon={<UploadOutlined />} loading={importWordMut.isPending}>导入 Word 图文</Button></Upload>
        </Space>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 850 }}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage }}
        />
      </Card>
      <Modal
        title={editing ? '编辑内容' : '创建内容'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending || uploadMut.isPending}
        okButtonProps={{ disabled: uploadMut.isPending }}
        width={680}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => saveMut.mutate({ ...values, tags: values.tags || [] })}
        >
          <Space size={16} align="start" style={{ width: '100%' }}>
            <Form.Item name="type" label="内容类型" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={[{ value: 'video', label: '视频' }, { value: 'image_text', label: '图文' }, { value: 'dynamic', label: '动态' }]} />
            </Form.Item>
            <Form.Item name="source" label="内容来源" style={{ width: 180 }}>
              <Select options={[{ value: 'manual', label: '手动创建' }, { value: 'ai', label: 'AI 创作' }, { value: 'digital_human', label: '数字人' }, { value: 'recreation', label: '爆款二创' }]} />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true }, { max: 100 }]}><Input /></Form.Item>
          <Form.Item name="videoUrl" label="视频文件/链接">
            <Input
              placeholder="上传文件后自动填充，也可填写平台可访问的 HTTPS 地址"
              addonAfter={(
                <Upload showUploadList={false} beforeUpload={(file) => upload('videoUrl', file)} accept="video/*">
                  <Button type="text" size="small" icon={<UploadOutlined />} loading={uploading === 'videoUrl'}>上传视频</Button>
                </Upload>
              )}
            />
          </Form.Item>
          <Form.Item name="coverUrl" label="封面文件/链接">
            <Input
              placeholder="上传封面或填写 HTTPS 地址"
              addonAfter={(
                <Upload showUploadList={false} beforeUpload={(file) => upload('coverUrl', file)} accept="image/*">
                  <Button type="text" size="small" icon={<UploadOutlined />} loading={uploading === 'coverUrl'}>上传封面</Button>
                </Upload>
              )}
            />
          </Form.Item>
          <Form.Item name="body" label="正文"><Input.TextArea rows={4} maxLength={20_000} showCount /></Form.Item>
          <Form.Item name="tags" label="话题标签"><Select mode="tags" tokenSeparators={[',', '，']} placeholder="输入后回车，可添加多个标签" /></Form.Item>
          <Form.Item name="watermark" label="企业水印图片 URL"><Input placeholder="发布视频时自动叠加；请填写透明 PNG 地址" /></Form.Item>
          <Space size={16} align="start" style={{ width: '100%' }}>
            <Form.Item name="attachType" label="挂载组件" style={{ width: 180 }}>
              <Select allowClear options={[{ value: 'cart', label: '购物车' }, { value: 'poi', label: 'POI/团购' }, { value: 'website', label: '企业官网' }, { value: 'lead_form', label: '留资表单' }]} />
            </Form.Item>
            <Form.Item name="attachValue" label="组件 ID/链接" style={{ minWidth: 360, flex: 1 }}><Input /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </PageContainer>
  );
}
