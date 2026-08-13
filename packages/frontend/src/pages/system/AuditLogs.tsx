import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag } from 'antd';
import { systemApi } from '@/api';
import PageContainer from '@/components/PageContainer';

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['audit-logs', page], queryFn: () => systemApi.logs({ page, pageSize: 15 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;

  const columns = [
    { title: '操作人', dataIndex: ['user', 'name'], render: (v: string) => v || '-' },
    { title: '操作', dataIndex: 'action', render: (a: string) => { const m = a.split(' ')[0]; return <Tag color={m === 'POST' ? 'blue' : m === 'DELETE' ? 'red' : 'orange'}>{a}</Tag>; } },
    { title: '目标', dataIndex: 'target', ellipsis: true },
    { title: 'IP', dataIndex: 'ip', render: (v: string) => v || '-' },
    { title: '时间', dataIndex: 'createdAt', render: (t: string) => new Date(t).toLocaleString('zh-CN') },
  ];

  return (
    <PageContainer title="审计日志">
      <Card>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 15, total, onChange: setPage }} />
      </Card>
    </PageContainer>
  );
}
