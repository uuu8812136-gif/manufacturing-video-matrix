import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Select, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { dataApi } from '@/api';
import { PLATFORM_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';

interface HotTopic {
  id: string;
  platform: string;
  type: string;
  title: string;
  hotValue: number;
  rank: number;
  crawledAt: string;
}

export default function HotTopics() {
  const [platform, setPlatform] = useState<string>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data, isLoading } = useQuery({ queryKey: ['hot-topics', platform], queryFn: () => dataApi.hotTopics(platform) });
  const sync = useMutation({
    mutationFn: dataApi.syncHotTopics,
    onSuccess: (result) => {
      const status = result as { synced?: number; skipped?: boolean; reason?: string };
      if (status.skipped) {
        message.warning(status.reason || '热点服务未配置，未执行同步');
        return;
      }
      message.success(`热点榜单已同步（${status.synced || 0} 条）`);
      qc.invalidateQueries({ queryKey: ['hot-topics'] });
    },
  });
  const columns = [
    { title: '排名', dataIndex: 'rank', width: 80 },
    { title: '平台', dataIndex: 'platform', width: 120, render: (value: string) => <Tag>{PLATFORM_LABELS[value] || value}</Tag> },
    { title: '热点', dataIndex: 'title' },
    { title: '类型', dataIndex: 'type', width: 100 },
    { title: '热度', dataIndex: 'hotValue', width: 140, sorter: (a: HotTopic, b: HotTopic) => a.hotValue - b.hotValue, render: (value: number) => value.toLocaleString() },
    { title: '更新时间', dataIndex: 'crawledAt', width: 180, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
  ];
  return (
    <PageContainer title="热点榜单">
      <Card
        title={<Select allowClear placeholder="全部平台" style={{ width: 140 }} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))} onChange={setPlatform} />}
        extra={<Button icon={<ReloadOutlined />} loading={sync.isPending} onClick={() => sync.mutate()}>立即同步</Button>}
      >
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={(data || []) as HotTopic[]} />
      </Card>
    </PageContainer>
  );
}
