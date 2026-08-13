import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, InputNumber, Modal, Row, Space, Spin, Statistic, Table, Tag } from 'antd';
import { channelApi } from '@/api';
import PageContainer from '@/components/PageContainer';

export default function ChannelReport() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [paidCustomer, setPaidCustomer] = useState<Record<string, unknown> | null>(null);
  const [paidForm] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['channel-report'], queryFn: () => channelApi.report() });
  const { data: customers, isLoading: customersLoading } = useQuery({ queryKey: ['channel-customers'], queryFn: channelApi.customers });
  const value = (data || {}) as { summary?: { registered: number; paid: number; renewalRate: number; totalCommission: number }; byChannel?: { name: string; registered: number; paid: number; commission: number }[] };
  const customerList = (customers as Record<string, unknown>[]) || [];

  const paidMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => channelApi.markPaid(id, amount),
    onSuccess: () => { message.success('付费已登记，返佣已自动生成'); setPaidCustomer(null); paidForm.resetFields(); refresh(); },
  });
  const settleMut = useMutation({
    mutationFn: (id: string) => channelApi.settle(id, true),
    onSuccess: () => { message.success('返佣已结算'); refresh(); },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['channel-report'] });
    qc.invalidateQueries({ queryKey: ['channel-customers'] });
  };

  const channelColumns = [
    { title: '渠道', dataIndex: 'name' },
    { title: '注册数', dataIndex: 'registered' },
    { title: '付费数', dataIndex: 'paid' },
    { title: '付费转化率', dataIndex: 'paid', render: (_: number, row: { registered: number; paid: number }) => row.registered ? `${((row.paid / row.registered) * 100).toFixed(1)}%` : '-' },
    { title: '累计返佣', dataIndex: 'commission', render: (value: number) => <Tag color="green">¥{value.toFixed(2)}</Tag> },
  ];
  const customerColumns = [
    { title: '企业', dataIndex: 'teamName', render: (value: string) => value || '-' },
    { title: '渠道', dataIndex: ['code', 'channel', 'name'] },
    { title: '邀请码', dataIndex: ['code', 'code'] },
    { title: '付费金额', dataIndex: 'paidAmount', render: (amount: number) => `¥${(amount || 0).toFixed(2)}` },
    { title: '返佣', render: (_: unknown, row: Record<string, unknown>) => `¥${((((row.commissions as Record<string, unknown>[]) || [])[0]?.amount as number) || 0).toFixed(2)}` },
    { title: '结算状态', render: (_: unknown, row: Record<string, unknown>) => { const status = (((row.commissions as Record<string, unknown>[]) || [])[0]?.status as string) || 'none'; return <Tag color={status === 'settled' ? 'green' : status === 'pending' ? 'orange' : 'default'}>{status === 'settled' ? '已结算' : status === 'pending' ? '待结算' : '未付费'}</Tag>; } },
    { title: '操作', render: (_: unknown, row: Record<string, unknown>) => { const commission = ((row.commissions as Record<string, unknown>[]) || [])[0]; return <Space>{!row.paid && <Button size="small" onClick={() => setPaidCustomer(row)}>登记付费</Button>}{commission?.status === 'pending' && <Button size="small" type="primary" loading={settleMut.isPending} onClick={() => settleMut.mutate(row.id as string)}>结算返佣</Button>}</Space>; } },
  ];

  return (
    <PageContainer title="渠道报表">
      <Spin spinning={isLoading}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}><Card><Statistic title="总注册数" value={value.summary?.registered || 0} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="付费数" value={value.summary?.paid || 0} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="付费转化率" value={value.summary?.renewalRate || 0} suffix="%" /></Card></Col>
          <Col xs={12} md={6}><Card><Statistic title="累计返佣" value={value.summary?.totalCommission || 0} prefix="¥" precision={2} /></Card></Col>
        </Row>
        <Card title="分渠道明细"><Table rowKey="name" columns={channelColumns} dataSource={value.byChannel || []} pagination={false} /></Card>
        <Card title="渠道客户与返佣结算" style={{ marginTop: 16 }}><Table rowKey="id" loading={customersLoading} columns={customerColumns} dataSource={customerList} pagination={{ pageSize: 20 }} /></Card>
      </Spin>
      <Modal title={`登记付费：${paidCustomer?.teamName || ''}`} open={!!paidCustomer} onCancel={() => setPaidCustomer(null)} onOk={() => paidForm.submit()} confirmLoading={paidMut.isPending}>
        <Form form={paidForm} layout="vertical" onFinish={(formValue) => paidCustomer && paidMut.mutate({ id: paidCustomer.id as string, amount: formValue.amount })}>
          <Form.Item
            name="amount"
            label="实际付费金额"
            rules={[
              { required: true, message: '请输入实际付费金额' },
              { type: 'number', min: 0.01, message: '实际付费金额必须大于 0' },
            ]}
          >
            <InputNumber step={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
