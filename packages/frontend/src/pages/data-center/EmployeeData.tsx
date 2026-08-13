import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Progress } from 'antd';
import { dataApi } from '@/api';
import { ROLE_LABELS, ROLE_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

export default function EmployeeData() {
  const { data, isLoading } = useQuery({ queryKey: ['employee'], queryFn: dataApi.employee });
  const list = (data as { id: string; name: string; role: string; contentCount: number; publishedCount: number; completedTaskCount: number }[]) || [];
  const max = Math.max(1, ...list.map((l) => l.contentCount));

  const columns = [
    { title: '成员', dataIndex: 'name' },
    { title: '角色', dataIndex: 'role', render: (r: string) => <Tag color={ROLE_COLORS[r]}>{ROLE_LABELS[r] || r}</Tag> },
    { title: '内容产出数', dataIndex: 'contentCount', sorter: (a: { contentCount: number }, b: { contentCount: number }) => b.contentCount - a.contentCount },
    { title: '发布成功', dataIndex: 'publishedCount' },
    { title: '完成任务', dataIndex: 'completedTaskCount' },
    { title: '产出占比', render: (_: unknown, r: { contentCount: number }) => <Progress percent={Math.round((r.contentCount / max) * 100)} size="small" /> },
  ];

  return (
    <PageContainer title="员工数据">
      <Card>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
    </PageContainer>
  );
}
