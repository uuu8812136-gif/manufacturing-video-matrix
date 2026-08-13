import { useQuery } from '@tanstack/react-query';
import { Card, Progress, Table, Tag } from 'antd';
import { teamApi } from '@/api';
import { ROLE_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';

interface PerformanceRow {
  id: string;
  name: string;
  role: string;
  taskCount: number;
  doneCount: number;
}

export default function Performance() {
  const { data, isLoading } = useQuery({ queryKey: ['team-performance'], queryFn: teamApi.performance });
  const rows = (data || []) as PerformanceRow[];
  const columns = [
    { title: '成员', dataIndex: 'name' },
    { title: '角色', dataIndex: 'role', render: (value: string) => <Tag>{ROLE_LABELS[value] || value}</Tag> },
    { title: '任务总数', dataIndex: 'taskCount', width: 120 },
    { title: '已完成', dataIndex: 'doneCount', width: 120 },
    { title: '完成率', render: (_: unknown, row: PerformanceRow) => <Progress percent={row.taskCount ? Math.round((row.doneCount / row.taskCount) * 100) : 0} /> },
  ];
  return <PageContainer title="团队绩效"><Card><Table rowKey="id" loading={isLoading} columns={columns} dataSource={rows} pagination={false} /></Card></PageContainer>;
}
