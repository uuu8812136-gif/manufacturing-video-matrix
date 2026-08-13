import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Upload,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { productApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;

interface ProductMaterial {
  id: string;
  name: string;
  url: string;
}

interface Product {
  id: string;
  name: string;
  categoryId?: string;
  category?: { id: string; name: string };
  parameters?: Record<string, string>;
  sellingPoints?: string[];
  scenarios?: string[];
  brandScript?: string;
  materials?: ProductMaterial[];
}

interface Category {
  id: string;
  name: string;
}

export default function ProductLibrary() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product>();
  const [detailId, setDetailId] = useState<string>();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [form] = Form.useForm();
  const [categoryForm] = Form.useForm();
  const [materialForm] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['products', page],
    queryFn: () => productApi.list({ page, pageSize: 10 }),
  });
  const list = ((data as { list?: Product[] })?.list || []);
  const total = (data as { total?: number })?.total || 0;
  const { data: categoriesData } = useQuery({ queryKey: ['product-categories'], queryFn: productApi.categories });
  const categories = (categoriesData as Category[]) || [];
  const { data: detailData } = useQuery({
    queryKey: ['product-detail', detailId],
    queryFn: () => productApi.get(detailId!),
    enabled: Boolean(detailId),
  });
  const detail = detailData as Product | undefined;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product-detail'] });
  };

  const saveMut = useMutation({
    mutationFn: (value: Record<string, unknown>) => editing
      ? productApi.update(editing.id, value)
      : productApi.create(value),
    onSuccess: () => {
      message.success(editing ? '产品已更新' : '产品已创建');
      setOpen(false);
      setEditing(undefined);
      form.resetFields();
      refresh();
    },
  });
  const deleteMut = useMutation({
    mutationFn: productApi.remove,
    onSuccess: () => { message.success('产品已删除'); refresh(); },
  });
  const categoryMut = useMutation({
    mutationFn: (name: string) => productApi.createCategory(name),
    onSuccess: () => {
      message.success('分类已创建');
      setCategoryOpen(false);
      categoryForm.resetFields();
      qc.invalidateQueries({ queryKey: ['product-categories'] });
    },
  });
  const importMut = useMutation({
    mutationFn: productApi.importFile,
    onSuccess: (result) => {
      message.success(`已导入 ${(result as { count?: number }).count || 0} 个产品`);
      refresh();
    },
  });
  const materialMut = useMutation({
    mutationFn: (value: { name: string; url: string }) => productApi.addMaterial(detailId!, value),
    onSuccess: () => { message.success('素材已关联'); materialForm.resetFields(); refresh(); },
  });
  const removeMaterialMut = useMutation({
    mutationFn: (materialId: string) => productApi.removeMaterial(detailId!, materialId),
    onSuccess: () => { message.success('素材已移除'); refresh(); },
  });

  const openEditor = (product?: Product) => {
    setEditing(product);
    form.setFieldsValue(product ? {
      ...product,
      parameters: Object.entries(product.parameters || {}).map(([key, value]) => `${key}:${value}`).join('\n'),
      sellingPoints: (product.sellingPoints || []).join('\n'),
      scenarios: (product.scenarios || []).join('\n'),
    } : {});
    setOpen(true);
  };

  const normalize = (value: Record<string, string>) => ({
    ...value,
    parameters: value.parameters
      ? Object.fromEntries(value.parameters.split('\n').filter(Boolean).map((line) => {
          const index = line.search(/[:：]/);
          return index < 0 ? [line.trim(), ''] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }))
      : {},
    sellingPoints: value.sellingPoints?.split('\n').map((item) => item.trim()).filter(Boolean) || [],
    scenarios: value.scenarios?.split('\n').map((item) => item.trim()).filter(Boolean) || [],
  });

  const columns = [
    { title: '产品名称', dataIndex: 'name' },
    { title: '分类', dataIndex: ['category', 'name'], render: (value: string) => value || '-' },
    { title: '卖点', dataIndex: 'sellingPoints', render: (value: string[] = []) => value.slice(0, 3).map((item) => <Tag key={item} color="blue">{item}</Tag>) },
    {
      title: '操作',
      width: 210,
      render: (_: unknown, row: Product) => (
        <Space>
          <Button type="link" size="small" onClick={() => setDetailId(row.id)}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditor(row)}>编辑</Button>
          <Popconfirm title="确认删除该产品？" onConfirm={() => deleteMut.mutate(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="产品信息库">
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>添加产品</Button>
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => { importMut.mutate(file as unknown as File); return false; }}
          >
            <Button icon={<UploadOutlined />} loading={importMut.isPending}>Excel 参数表导入</Button>
          </Upload>
          <Button onClick={() => setCategoryOpen(true)}>管理分类</Button>
        </Space>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={list}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage }}
        />
      </Card>

      <Modal
        title={editing ? '编辑产品' : '添加产品'}
        open={open}
        onCancel={() => { setOpen(false); setEditing(undefined); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(value) => saveMut.mutate(normalize(value))}>
          <Form.Item name="name" label="产品名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="categoryId" label="产品分类"><Select allowClear options={categories.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="parameters" label="产品参数（每行：参数:值）"><TextArea rows={4} /></Form.Item>
          <Form.Item name="sellingPoints" label="卖点（每行一条）"><TextArea rows={3} /></Form.Item>
          <Form.Item name="scenarios" label="应用场景（每行一条）"><TextArea rows={3} /></Form.Item>
          <Form.Item name="brandScript" label="品牌话术"><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="创建产品分类" open={categoryOpen} onCancel={() => setCategoryOpen(false)} onOk={() => categoryForm.submit()} confirmLoading={categoryMut.isPending}>
        <Form form={categoryForm} layout="vertical" onFinish={(value) => categoryMut.mutate(value.name)}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Drawer title="产品详情与素材" open={Boolean(detailId)} onClose={() => setDetailId(undefined)} width={600}>
        {detail && (
          <>
            <Descriptions title={detail.name} column={1} bordered size="small">
              <Descriptions.Item label="分类">{detail.category?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="参数">{Object.entries(detail.parameters || {}).map(([key, value]) => <Tag key={key}>{key}: {value}</Tag>)}</Descriptions.Item>
              <Descriptions.Item label="卖点">{detail.sellingPoints?.map((item) => <Tag key={item} color="blue">{item}</Tag>)}</Descriptions.Item>
              <Descriptions.Item label="应用场景">{detail.scenarios?.map((item) => <Tag key={item} color="orange">{item}</Tag>)}</Descriptions.Item>
              <Descriptions.Item label="品牌话术">{detail.brandScript || '-'}</Descriptions.Item>
            </Descriptions>
            <Form form={materialForm} layout="inline" style={{ marginTop: 24, marginBottom: 16 }} onFinish={(value) => materialMut.mutate(value)}>
              <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="素材名称" /></Form.Item>
              <Form.Item name="url" rules={[{ required: true }]}><Input placeholder="素材 URL" style={{ width: 240 }} /></Form.Item>
              <Button type="primary" htmlType="submit" loading={materialMut.isPending}>关联素材</Button>
            </Form>
            <List
              header="已关联素材"
              dataSource={detail.materials || []}
              locale={{ emptyText: '暂无关联素材' }}
              renderItem={(item) => (
                <List.Item actions={[<Button key="remove" type="link" danger onClick={() => removeMaterialMut.mutate(item.id)}>移除</Button>]}>
                  <List.Item.Meta title={item.name} description={<a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>} />
                </List.Item>
              )}
            />
          </>
        )}
      </Drawer>
    </PageContainer>
  );
}
