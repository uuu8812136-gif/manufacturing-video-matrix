import { useQuery } from '@tanstack/react-query';
import { Card, Progress, Table, Tag } from 'antd';
import { dataApi } from '@/api';
import PageContainer from '@/components/PageContainer';

interface ContentPerformance {
  id: string;
  title: string;
  type: string;
  source: string;
  targetCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  createdAt: string;
}

export default function ContentData() {
  const { data, isLoading } = useQuery({ queryKey: ['content-performance'], queryFn: dataApi.contentPerformance });
  const list = (data || []) as ContentPerformance[];
  const columns = [
    { title: '内容标题', dataIndex: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'type', width: 100, render: (value: string) => <Tag>{value}</Tag> },
    { title: '来源', dataIndex: 'source', width: 110 },
    { title: '目标账号', dataIndex: 'targetCount', width: 100 },
    { title: '成功', dataIndex: 'successCount', width: 80 },
    { title: '失败', dataIndex: 'failedCount', width: 80 },
    { title: '成功率', dataIndex: 'successRate', width: 180, render: (value: number) => <Progress percent={value} size="small" status={value < 80 ? 'exception' : 'success'} /> },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
  ];
  return (
    <PageContainer title="内容数据">
      <Card><Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} /></Card>
    </PageContainer>
  );
}
