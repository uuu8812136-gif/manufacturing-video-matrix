import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag } from 'antd';
import { dataApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

export default function AccountData() {
  const { data, isLoading } = useQuery({ queryKey: ['ranking'], queryFn: dataApi.ranking });
  const list = (data as Record<string, unknown>[]) || [];

  const columns = [
    { title: '排名', width: 70, render: (_: unknown, __: unknown, i: number) => i + 1 },
    { title: '账号', dataIndex: 'nickname' },
    { title: '平台', dataIndex: 'platform', render: (p: string) => <Tag color={PLATFORM_COLORS[p]}>{PLATFORM_LABELS[p]}</Tag> },
    {
      title: '粉丝数',
      dataIndex: 'followerCount',
      sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const aSynced = Boolean(a.followerCountSyncedAt);
        const bSynced = Boolean(b.followerCountSyncedAt);
        if (aSynced !== bSynced) return aSynced ? -1 : 1;
        return (b.followerCount as number) - (a.followerCount as number);
      },
      render: (n: number, account: Record<string, unknown>) => account.followerCountSyncedAt
        ? n.toLocaleString()
        : <span style={{ color: '#94a3b8' }}>未同步</span>,
    },
    { title: '播放量', dataIndex: 'playCount', sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => (b.playCount as number) - (a.playCount as number), render: (n: number) => n?.toLocaleString() },
    { title: '点赞数', dataIndex: 'likeCount', render: (n: number) => n?.toLocaleString() },
  ];

  return (
    <PageContainer title="账号数据">
      <Card>
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
    </PageContainer>
  );
}
