import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Popconfirm, Table, Tag } from 'antd';
import { contentApi } from '@/api';
import { PLATFORM_LABELS, PUBLISH_STATUS_LABELS, PUBLISH_STATUS_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

export default function PublishTasks() {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data, isLoading } = useQuery({ queryKey: ['publish-tasks', page], queryFn: () => contentApi.tasks({ page, pageSize: 10 }) });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;
  const cancelMut = useMutation({
    mutationFn: contentApi.cancelTask,
    onSuccess: () => {
      message.success('定时发布已取消');
      qc.invalidateQueries({ queryKey: ['publish-tasks'] });
    },
  });

  const expandRender = (record: Record<string, unknown>) => {
    const records = (record.records as Record<string, unknown>[]) || [];
    return (
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={records}
        columns={[
          { title: '账号', dataIndex: ['account', 'nickname'] },
          { title: '平台', dataIndex: 'platform', render: (p: string) => PLATFORM_LABELS[p] || p },
          { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={PUBLISH_STATUS_COLORS[s]}>{PUBLISH_STATUS_LABELS[s] || s}</Tag> },
          { title: '平台内容ID', dataIndex: 'platformContentId', render: (v: string) => v || '-' },
          { title: '失败原因', dataIndex: 'failReason', render: (v: string) => v || '-' },
          { title: '发布时间', dataIndex: 'publishedAt', render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
        ]}
      />
    );
  };

  const columns = [
    { title: '内容标题', dataIndex: ['content', 'title'], ellipsis: true },
    { title: '账号数', dataIndex: 'accountIds', width: 80, render: (v: string) => (v ? JSON.parse(v).length : 0) },
    { title: '定时时间', dataIndex: 'scheduledAt', width: 170, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '立即' },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={PUBLISH_STATUS_COLORS[s]}>{PUBLISH_STATUS_LABELS[s] || s}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, task: Record<string, unknown>) => task.status === 'scheduled' ? (
        <Popconfirm title="确定取消这个定时发布任务？" onConfirm={() => cancelMut.mutate(task.id as string)}>
          <Button type="link" danger size="small" loading={cancelMut.isPending}>取消</Button>
        </Popconfirm>
      ) : '-',
    },
  ];

  return (
    <PageContainer title="发布队列">
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={list}
          expandable={{ expandedRowRender: expandRender, rowExpandable: (r: Record<string, unknown>) => !!((r.records as Record<string, unknown>[] | undefined)?.length) }}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage }}
        />
      </Card>
    </PageContainer>
  );
}
