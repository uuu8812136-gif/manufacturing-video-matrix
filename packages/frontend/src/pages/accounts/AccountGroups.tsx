import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { accountApi } from '@/api';
import PageContainer from '@/components/PageContainer';

type GroupRow = {
  id: string;
  name: string;
  dimension: string;
  _count: { accounts: number };
};

type RegionRow = {
  id: string;
  name: string;
  level: number;
  parentId?: string | null;
};

const dimensionLabels: Record<string, string> = {
  region: '区域',
  product: '产品线',
  department: '部门',
  dealer: '经销商',
};

const levelLabels: Record<number, string> = { 1: '省级', 2: '市级', 3: '区县级' };

export default function AccountGroups() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<RegionRow | null>(null);
  const [groupForm] = Form.useForm();
  const [regionForm] = Form.useForm();

  const { data: groupData, isLoading: groupLoading } = useQuery({
    queryKey: ['account-groups'],
    queryFn: accountApi.groups,
  });
  const groups = (groupData as GroupRow[]) || [];
  const { data: regionData, isLoading: regionLoading } = useQuery({
    queryKey: ['account-regions'],
    queryFn: accountApi.regions,
  });
  const regions = (regionData as RegionRow[]) || [];

  const saveGroup = useMutation({
    mutationFn: (values: { name: string; dimension: string }) => editingGroup
      ? accountApi.updateGroup(editingGroup.id, values)
      : accountApi.createGroup(values),
    onSuccess: () => {
      message.success(editingGroup ? '分组已更新' : '分组已创建');
      setGroupOpen(false);
      setEditingGroup(null);
      groupForm.resetFields();
      qc.invalidateQueries({ queryKey: ['account-groups'] });
    },
  });
  const removeGroup = useMutation({
    mutationFn: accountApi.removeGroup,
    onSuccess: () => {
      message.success('分组已删除');
      qc.invalidateQueries({ queryKey: ['account-groups'] });
    },
  });
  const saveRegion = useMutation({
    mutationFn: (values: { name: string; level: number; parentId?: string }) => editingRegion
      ? accountApi.updateRegion(editingRegion.id, values)
      : accountApi.createRegion(values),
    onSuccess: () => {
      message.success(editingRegion ? '区域已更新' : '区域已创建');
      setRegionOpen(false);
      setEditingRegion(null);
      regionForm.resetFields();
      qc.invalidateQueries({ queryKey: ['account-regions'] });
    },
  });
  const removeRegion = useMutation({
    mutationFn: accountApi.removeRegion,
    onSuccess: () => {
      message.success('区域已删除');
      qc.invalidateQueries({ queryKey: ['account-regions'] });
    },
  });

  const openGroup = (row?: GroupRow) => {
    setEditingGroup(row || null);
    groupForm.setFieldsValue(row ? { name: row.name, dimension: row.dimension } : { dimension: 'region' });
    setGroupOpen(true);
  };
  const openRegion = (row?: RegionRow) => {
    setEditingRegion(row || null);
    regionForm.setFieldsValue(row
      ? { name: row.name, level: row.level, parentId: row.parentId || undefined }
      : { level: 1 });
    setRegionOpen(true);
  };

  const groupColumns = [
    { title: '分组名称', dataIndex: 'name' },
    { title: '分组维度', dataIndex: 'dimension', render: (value: string) => dimensionLabels[value] || value },
    { title: '账号数', dataIndex: ['_count', 'accounts'] },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: GroupRow) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openGroup(row)}>编辑</Button>
          <Popconfirm title="仅空分组可删除，确定继续？" onConfirm={() => removeGroup.mutate(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const regionColumns = [
    { title: '区域名称', dataIndex: 'name' },
    { title: '层级', dataIndex: 'level', render: (value: number) => levelLabels[value] || `${value}级` },
    {
      title: '上级区域',
      dataIndex: 'parentId',
      render: (value: string) => regions.find((item) => item.id === value)?.name || '-',
    },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: RegionRow) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRegion(row)}>编辑</Button>
          <Popconfirm title="仅无账号、无下级的区域可删除，确定继续？" onConfirm={() => removeRegion.mutate(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="分组与区域管理">
      <Card
        title="账号分组"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openGroup()}>新建分组</Button>}
        style={{ marginBottom: 16 }}
      >
        <Table rowKey="id" loading={groupLoading} columns={groupColumns} dataSource={groups} pagination={false} />
      </Card>
      <Card
        title="区域管理"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openRegion()}>新建区域</Button>}
      >
        <Table rowKey="id" loading={regionLoading} columns={regionColumns} dataSource={regions} pagination={false} />
      </Card>

      <Modal
        title={editingGroup ? '编辑分组' : '新建分组'}
        open={groupOpen}
        onCancel={() => { setGroupOpen(false); setEditingGroup(null); groupForm.resetFields(); }}
        onOk={() => groupForm.submit()}
        confirmLoading={saveGroup.isPending}
      >
        <Form form={groupForm} layout="vertical" onFinish={(values) => saveGroup.mutate(values)}>
          <Form.Item name="name" label="分组名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="dimension" label="分组维度" rules={[{ required: true }]}>
            <Select options={Object.entries(dimensionLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRegion ? '编辑区域' : '新建区域'}
        open={regionOpen}
        onCancel={() => { setRegionOpen(false); setEditingRegion(null); regionForm.resetFields(); }}
        onOk={() => regionForm.submit()}
        confirmLoading={saveRegion.isPending}
      >
        <Form form={regionForm} layout="vertical" onFinish={(values) => saveRegion.mutate(values)}>
          <Form.Item name="name" label="区域名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="level" label="区域层级" rules={[{ required: true }]}>
            <Select options={Object.entries(levelLabels).map(([value, label]) => ({ value: Number(value), label }))} />
          </Form.Item>
          <Form.Item name="parentId" label="上级区域">
            <Select
              allowClear
              options={regions.filter((item) => item.id !== editingRegion?.id).map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
