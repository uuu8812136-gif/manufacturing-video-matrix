import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Modal, Select, Table, Tag } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { accountApi, contentApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

type DealerRow = Record<string, unknown> & {
  id: string;
  nickname: string;
  platform: string;
  status: string;
};

export default function DealerMatrix() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [pushdownOpen, setPushdownOpen] = useState(false);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['dealer-dashboard'], queryFn: accountApi.dealerDashboard });
  const list = (data as DealerRow[]) || [];
  const { data: contents } = useQuery({
    queryKey: ['contents-for-dealer-pushdown'],
    queryFn: () => contentApi.list({ page: 1, pageSize: 100 }),
  });
  const contentList = (contents as { list?: Array<{ id: string; title: string; type: string }> })?.list || [];

  const pushdownMut = useMutation({
    mutationFn: (values: { contentId: string; accountIds: string[] }) => accountApi.pushdown({
      contentId: values.contentId,
      accountIds: { dealers: values.accountIds },
    }),
    onSuccess: () => {
      message.success('总部内容已进入经销商发布队列');
      setPushdownOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['publish-tasks'] });
    },
  });

  const columns = [
    { title: '排名', dataIndex: 'rank', width: 70, render: (rank: number) => (rank <= 3 ? <Tag color="gold">第{rank}名</Tag> : `第${rank}名`) },
    { title: '经销商账号', dataIndex: 'nickname' },
    { title: '平台', dataIndex: 'platform', render: (platform: string) => <Tag color={PLATFORM_COLORS[platform]}>{PLATFORM_LABELS[platform]}</Tag> },
    { title: '区域', dataIndex: 'region', render: (value: string) => value || '-' },
    { title: '粉丝数', dataIndex: 'followerCount', render: (value: number) => value?.toLocaleString() },
    { title: '发布数', dataIndex: 'publishCount' },
    { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'active' ? 'success' : 'error'}>{status === 'active' ? '活跃' : '异常'}</Tag> },
  ];

  return (
    <PageContainer title="经销商矩阵">
      <Card
        title="经销商数据看板与排名"
        extra={<Button type="primary" icon={<ShareAltOutlined />} onClick={() => setPushdownOpen(true)}>总部内容下发</Button>}
      >
        <Table rowKey="id" loading={isLoading} columns={columns} dataSource={list} pagination={false} />
      </Card>
      <Modal
        title="总部内容下发"
        open={pushdownOpen}
        onCancel={() => { setPushdownOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={pushdownMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => pushdownMut.mutate(values)}>
          <Form.Item name="contentId" label="选择内容" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={contentList.map((content) => ({
                value: content.id,
                label: `${content.title}（${content.type === 'video' ? '视频' : '图文'}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="accountIds" label="目标经销商账号" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={list.filter((item) => item.status === 'active').map((item) => ({
                value: item.id,
                label: `${item.nickname} · ${PLATFORM_LABELS[item.platform] || item.platform}`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
