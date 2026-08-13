import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Popconfirm, Space, Table, Tag } from 'antd';
import { CloudDownloadOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
import { systemApi } from '@/api';
import PageContainer from '@/components/PageContainer';
import { downloadBlob } from '@/utils/download';

export default function Backups() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: systemApi.backups });
  const rows = (data as Record<string, unknown>[]) || [];
  const createMut = useMutation({ mutationFn: systemApi.createBackup, onSuccess: () => { message.success('备份已完成'); qc.invalidateQueries({ queryKey: ['backups'] }); } });
  const restoreMut = useMutation({ mutationFn: systemApi.restoreBackup, onSuccess: () => message.success('数据库已恢复，请检查业务数据') });
  const downloadMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => systemApi.downloadBackup(id).then((blob) => ({ blob, name })),
    onSuccess: ({ blob, name }) => {
      downloadBlob(blob, name);
    },
  });
  const columns = [
    { title: '类型', dataIndex: 'type', render: (type: string) => <Tag color={type === 'full' ? 'blue' : 'cyan'}>{type === 'full' ? '全量' : '增量'}</Tag> },
    { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'success' ? 'green' : status === 'running' ? 'gold' : 'red'}>{status === 'success' ? '成功' : status === 'running' ? '进行中' : '失败'}</Tag> },
    { title: '大小', dataIndex: 'size', render: (size: number) => size ? `${(size / 1024 / 1024).toFixed(2)} MB` : '-' },
    {
      title: '备份范围',
      dataIndex: 'detail',
      render: (detail: string, row: Record<string, unknown>) => {
        if (row.type !== 'full') return <span style={{ color: '#8c8c8c' }}>数据快照（不可独立恢复）</span>;
        try {
          const value = JSON.parse(detail || '{}') as { assetCount?: number; browserSessionCount?: number };
          return value.assetCount === undefined
            ? <span style={{ color: '#8c8c8c' }}>旧版：仅数据库</span>
            : `数据库 + ${value.assetCount} 个素材 + ${value.browserSessionCount || 0} 个扫码登录态`;
        } catch {
          return '-';
        }
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    { title: '操作', render: (_: unknown, row: Record<string, unknown>) => <Space><Button size="small" icon={<CloudDownloadOutlined />} disabled={row.status !== 'success'} loading={downloadMut.isPending} onClick={() => downloadMut.mutate({ id: row.id as string, name: String(row.fileUrl || 'backup').split('/').pop() || 'backup' })}>下载</Button>{row.type === 'full' && <Popconfirm title="恢复会覆盖数据库，并合并恢复素材与扫码登录态，确定继续？" okText="确定恢复" okButtonProps={{ danger: true }} onConfirm={() => restoreMut.mutate(row.id as string)}><Button size="small" danger icon={<ReloadOutlined />} disabled={row.status !== 'success'} loading={restoreMut.isPending}>恢复</Button></Popconfirm>}</Space> },
  ];
  return <PageContainer title="备份与恢复"><Alert showIcon type="info" style={{ marginBottom: 16 }} message="一体化全量备份包含数据库、MinIO 素材和扫码登录态，可下载到独立存储；增量项是审计数据快照，不能单独恢复。" /><Card extra={<Space><Button icon={<DatabaseOutlined />} loading={createMut.isPending} onClick={() => createMut.mutate('incremental')}>增量快照</Button><Button type="primary" icon={<DatabaseOutlined />} loading={createMut.isPending} onClick={() => createMut.mutate('full')}>一体化全量备份</Button></Space>}><Table rowKey="id" loading={isLoading} columns={columns} dataSource={rows} pagination={false} /></Card></PageContainer>;
}
