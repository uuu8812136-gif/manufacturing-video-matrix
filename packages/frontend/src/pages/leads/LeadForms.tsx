import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Button, Modal, Form, Input, Tag, App, Space, Typography, Select, Switch, Popconfirm, Checkbox } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { leadApi } from '@/api';
import PageContainer from '@/components/PageContainer';
import { useState } from 'react';

const { Text } = Typography;
type FormField = { name: string; label: string; type: string; required?: boolean };
type FormRow = Record<string, unknown> & { id: string; name: string; active: boolean };

const defaultFields: FormField[] = [
  { name: 'name', label: '姓名', type: 'text', required: true },
  { name: 'phone', label: '电话', type: 'tel', required: true },
  { name: 'company', label: '公司', type: 'text' },
  { name: 'demand', label: '需求', type: 'textarea' },
];

export default function LeadForms() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FormRow | null>(null);
  const [fields, setFields] = useState<FormField[]>(defaultFields);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({ queryKey: ['lead-forms'], queryFn: leadApi.forms });
  const list = (data as FormRow[]) || [];

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => editing
      ? leadApi.updateForm(editing.id, { ...values, fields })
      : leadApi.createForm({ ...values, fields }),
    onSuccess: () => { message.success(editing ? '表单已更新' : '表单已创建'); closeModal(); qc.invalidateQueries({ queryKey: ['lead-forms'] }); },
  });
  const statusMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => leadApi.updateForm(id, { active }),
    onSuccess: () => { message.success('状态已更新'); qc.invalidateQueries({ queryKey: ['lead-forms'] }); },
  });
  const removeMut = useMutation({
    mutationFn: leadApi.removeForm,
    onSuccess: () => { message.success('表单已删除'); qc.invalidateQueries({ queryKey: ['lead-forms'] }); },
  });

  const parseFields = (value: unknown): FormField[] => {
    if (Array.isArray(value)) return value as FormField[];
    try { return JSON.parse(String(value || '[]')); } catch { return defaultFields; }
  };
  const openCreate = () => {
    setEditing(null);
    setFields(defaultFields);
    form.resetFields();
    form.setFieldsValue({ template: 'consult' });
    setOpen(true);
  };
  const openEdit = (row: FormRow) => {
    setEditing(row);
    setFields(parseFields(row.fields));
    form.setFieldsValue({ name: row.name, template: row.template });
    setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditing(null); setFields(defaultFields); form.resetFields(); };

  const columns = [
    { title: '表单名称', dataIndex: 'name' },
    { title: '模板', dataIndex: 'template', render: (t: string) => t ? <Tag>{({ consult: '咨询产品', visit: '预约看厂', quote: '获取报价' }[t] || t)}</Tag> : '-' },
    { title: '收集线索数', dataIndex: ['_count', 'leads'] },
    { title: '状态', dataIndex: 'active', render: (active: boolean, row: FormRow) => <Switch checked={active} checkedChildren="启用" unCheckedChildren="停用" loading={statusMut.isPending} onChange={(checked) => statusMut.mutate({ id: row.id, active: checked })} /> },
    { title: '分享链接', dataIndex: 'shareUrl', render: (url: string) => url ? <Space><Text ellipsis style={{ maxWidth: 180 }}>{url}</Text><Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(url); message.success('已复制'); }} /></Space> : '-' },
    {
      title: '操作', width: 150, render: (_: unknown, row: FormRow) => <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
        <Popconfirm title="仅无历史线索的表单可删除，确定继续？" onConfirm={() => removeMut.mutate(row.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>,
    },
  ];

  return (
    <PageContainer title="留资表单">
      <Card>
        <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 16 }} onClick={openCreate}>创建留资表单</Button>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Modal title={editing ? '编辑留资表单' : '创建留资表单'} open={open} onCancel={closeModal} onOk={() => form.submit()} confirmLoading={saveMut.isPending} width={760}>
        <Form form={form} layout="vertical" onFinish={(values) => saveMut.mutate(values)}>
          <Form.Item name="name" label="表单名称" rules={[{ required: true }, { max: 60 }]}><Input /></Form.Item>
          <Form.Item name="template" label="模板" rules={[{ required: true }]}>
            <Select options={[{ value: 'consult', label: '咨询产品' }, { value: 'visit', label: '预约看厂' }, { value: 'quote', label: '获取报价' }]} />
          </Form.Item>
          <Text strong>自定义字段</Text>
          {fields.map((field, index) => (
            <Space key={`${index}-${field.name}`} style={{ display: 'flex', marginTop: 10 }} align="start">
              <Input placeholder="字段名（英文）" value={field.name} style={{ width: 140 }} onChange={(event) => setFields((items) => items.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
              <Input placeholder="显示标签" value={field.label} style={{ width: 140 }} onChange={(event) => setFields((items) => items.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
              <Select value={field.type} style={{ width: 120 }} options={[{ value: 'text', label: '单行文本' }, { value: 'tel', label: '电话' }, { value: 'email', label: '邮箱' }, { value: 'number', label: '数字' }, { value: 'textarea', label: '多行文本' }]} onChange={(value) => setFields((items) => items.map((item, i) => i === index ? { ...item, type: value } : item))} />
              <Checkbox checked={field.required} onChange={(event) => setFields((items) => items.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))}>必填</Checkbox>
              <Button danger size="small" disabled={fields.length <= 1} onClick={() => setFields((items) => items.filter((_, i) => i !== index))}>删除</Button>
            </Space>
          ))}
          <Button size="small" style={{ marginTop: 12 }} onClick={() => setFields((items) => [...items, { name: '', label: '', type: 'text' }])}>添加字段</Button>
        </Form>
      </Modal>
    </PageContainer>
  );
}
