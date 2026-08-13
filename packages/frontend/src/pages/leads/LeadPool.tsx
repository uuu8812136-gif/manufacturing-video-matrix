import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { Table, Tag, Button, App, Drawer, Form, Select, Input, Timeline, InputNumber, Row, Col } from 'antd';
import { DownloadOutlined, SyncOutlined, TeamOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { leadApi, userApi } from '@/api';
import { LEAD_STATUS_LABELS, INTENTION_LABELS, PLATFORM_LABELS } from '@/constants';
import PageContainer from '@/components/PageContainer';
import { downloadBlob } from '@/utils/download';

const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  assigned: '#06b6d4',
  following: '#f59e0b',
  intended: '#eab308',
  deal: '#10b981',
  lost: '#94a3b8',
};

const INTENTION_COLORS: Record<string, string> = {
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#94a3b8',
};

export default function LeadPool() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const [intention, setIntention] = useState<string>();
  const [platform, setPlatform] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [followForm] = Form.useForm();
  const [financeForm] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['leads', page, status, intention, platform, keyword],
    queryFn: () => leadApi.list({ page, pageSize: 10, status, intention, platform, keyword: keyword || undefined }),
  });
  const list = (data as { list: Record<string, unknown>[]; total: number })?.list || [];
  const total = (data as { total?: number })?.total || 0;

  const { data: members } = useQuery({ queryKey: ['members'], queryFn: userApi.members });
  const memberList = (members as Record<string, unknown>[]) || [];

  const { data: followUps } = useQuery({ queryKey: ['follow-ups', detail?.id], queryFn: () => leadApi.followUps(detail?.id as string), enabled: !!detail?.id });

  // 6 状态并行查询 total
  const statusKeys = Object.keys(LEAD_STATUS_LABELS);
  const statusCounts = useQueries({
    queries: statusKeys.map((s) => ({
      queryKey: ['leads-count', s],
      queryFn: () => leadApi.list({ page: 1, pageSize: 1, status: s }),
      staleTime: 30000,
    })),
  });
  const counts = statusKeys.map((s, i) => ({
    status: s,
    label: LEAD_STATUS_LABELS[s],
    count: ((statusCounts[i].data as { total?: number })?.total) || 0,
  }));
  const totalLeads = counts.reduce((sum, c) => sum + c.count, 0);

  const assignMut = useMutation({ mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string }) => leadApi.assign(id, assigneeId), onSuccess: () => { message.success('已分配'); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads-count'] }); } });
  const autoAssignMut = useMutation({ mutationFn: leadApi.autoAssign, onSuccess: (r) => { message.success(`已自动分配 ${(r as { assigned: number }).assigned} 条`); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads-count'] }); } });
  const updateMut = useMutation({ mutationFn: ({ id, v }: { id: string; v: Record<string, unknown> }) => leadApi.update(id, v), onSuccess: (_result, variables) => { message.success('已更新'); setDetail((current) => current ? { ...current, ...variables.v } : current); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads-count'] }); } });
  const followMut = useMutation({ mutationFn: ({ id, v }: { id: string; v: Record<string, unknown> }) => leadApi.addFollowUp(id, v), onSuccess: () => { message.success('跟进已记录'); followForm.resetFields(); qc.invalidateQueries({ queryKey: ['follow-ups'] }); } });
  const syncCrmMut = useMutation({
    mutationFn: leadApi.syncCrm,
    onSuccess: (result) => {
      const value = result as { synced: boolean; provider?: string; error?: string };
      if (value.synced) {
        message.success(`已同步到 ${value.provider || 'CRM'}`);
        setDetail((current) => current ? {
          ...current,
          crmProvider: value.provider,
          crmSyncedAt: new Date().toISOString(),
          crmSyncError: null,
        } : current);
        qc.invalidateQueries({ queryKey: ['leads'] });
      } else {
        message.warning(value.error || '未找到已启用的 CRM 配置，或网关未确认同步成功');
      }
    },
  });
  const exportMut = useMutation({
    mutationFn: leadApi.export,
    onSuccess: (blob) => {
      downloadBlob(blob, `leads-${new Date().toISOString().slice(0, 10)}.xlsx`);
    },
  });

  const toggleStatusFilter = (s: string) => {
    setStatus(s === status ? undefined : s);
    setPage(1);
  };
  const openDetail = (row: Record<string, unknown>) => {
    setDetail(row);
    financeForm.setFieldsValue({ estimatedValue: row.estimatedValue || 0, dealValue: row.dealValue || 0, sourceCost: row.sourceCost || 0 });
  };

  const columns = [
    { title: '客户姓名', dataIndex: 'name', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '电话', dataIndex: 'phone', render: (v: string) => <span className="tnum">{v}</span> },
    { title: '公司', dataIndex: 'company', render: (v: string) => v || <span style={{ color: '#94a3b8' }}>-</span> },
    { title: '来源平台', dataIndex: 'sourcePlatform', render: (p: string) => <Tag>{PLATFORM_LABELS[p] || p}</Tag> },
    { title: '意向', dataIndex: 'intention', width: 90, render: (i: string) => <Tag color={INTENTION_COLORS[i] || '#94a3b8'} style={{ color: '#fff', border: 'none' }}>{INTENTION_LABELS[i] || i}</Tag> },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={STATUS_COLORS[s] || '#94a3b8'} style={{ color: '#fff', border: 'none' }}>{LEAD_STATUS_LABELS[s] || s}</Tag> },
    { title: '负责人', dataIndex: ['assignee', 'name'], width: 100, render: (v: string) => v || <span style={{ color: '#94a3b8', fontSize: 12 }}>未分配</span> },
    { title: '操作', width: 230, render: (_: unknown, r: Record<string, unknown>) => (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Button size="small" type="link" onClick={() => openDetail(r)}>跟进</Button>
        <Select
          size="small"
          placeholder="分配负责人"
          style={{ width: 120 }}
          value={(r.assignee as { id?: string } | undefined)?.id}
          options={memberList.map((member) => ({ value: member.id as string, label: member.name as string }))}
          onChange={(assigneeId) => assignMut.mutate({ id: r.id as string, assigneeId })}
        />
      </div>
    ) },
  ];

  return (
    <PageContainer title="线索池">
      {/* 状态分布条 + 筛选区 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', margin: 0 }}>状态分布</h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>共 <span className="tnum" style={{ fontWeight: 600, color: '#0f172a' }}>{totalLeads}</span> 条线索</span>
        </div>

        {/* 比例横条 */}
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9', marginBottom: 16 }}>
          {totalLeads > 0 && counts.map((c) => c.count > 0 && (
            <motion.div
              key={c.status}
              initial={{ width: 0 }}
              animate={{ width: `${(c.count / totalLeads) * 100}%` }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
              style={{ background: STATUS_COLORS[c.status] }}
            />
          ))}
        </div>

        {/* 图例 + 筛选 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {counts.map((c) => (
              <div
                key={c.status}
                onClick={() => toggleStatusFilter(c.status)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: status === c.status ? '#f1f5f9' : 'transparent',
                  border: status === c.status ? '1px solid #e2e8f0' : '1px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLORS[c.status] }} />
                <span style={{ fontSize: 12, color: '#475569' }}>{c.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }} className="tnum">{c.count}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input.Search
              allowClear
              size="small"
              placeholder="姓名/电话/公司"
              style={{ width: 180 }}
              onSearch={(value) => { setKeyword(value.trim()); setPage(1); }}
            />
            <Select
              placeholder="来源平台"
              allowClear
              size="small"
              style={{ width: 120 }}
              value={platform}
              options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => { setPlatform(value); setPage(1); }}
            />
            <Select
              placeholder="意向"
              allowClear
              size="small"
              style={{ width: 110 }}
              value={intention}
              options={Object.entries(INTENTION_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) => { setIntention(v); setPage(1); }}
            />
            <Button size="small" type="link" icon={<TeamOutlined />} onClick={() => autoAssignMut.mutate()} loading={autoAssignMut.isPending}>
              自动分配
            </Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={() => exportMut.mutate()} loading={exportMut.isPending}>
              导出
            </Button>
          </div>
        </div>
      </motion.div>

      {/* 表格区 */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1050 }}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>

      <Drawer title="线索跟进" open={!!detail} onClose={() => setDetail(null)} width={480}>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* 客户信息 */}
            <div style={{ padding: '0 0 16px' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>客户信息</h4>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                  {detail.name as string} <span className="tnum" style={{ fontWeight: 400, color: '#64748b' }}>{detail.phone as string}</span>
                </div>
                <div>公司：{(detail.company as string) || '-'}</div>
                <div>需求：{(detail.demand as string) || '-'}</div>
                <div>来源：{PLATFORM_LABELS[detail.sourcePlatform as string] || (detail.sourcePlatform as string)} · {(detail.sourceContentTitle as string) || '-'}</div>
                <div>
                  CRM：{detail.crmSyncedAt
                    ? `${String(detail.crmProvider || '已同步')} · ${new Date(detail.crmSyncedAt as string).toLocaleString('zh-CN')}`
                    : (detail.crmSyncError as string) || '未同步'}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                  <span>意向：</span>
                  <Select size="small" defaultValue={detail.intention} style={{ width: 100 }} options={Object.entries(INTENTION_LABELS).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => updateMut.mutate({ id: detail.id as string, v: { intention: v } })} />
                  <span>状态：</span>
                  <Select size="small" defaultValue={detail.status} style={{ width: 110 }} options={Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => updateMut.mutate({ id: detail.id as string, v: { status: v } })} />
                  <Button size="small" icon={<SyncOutlined />} disabled={Boolean(detail.crmSyncedAt)} loading={syncCrmMut.isPending} onClick={() => syncCrmMut.mutate(detail.id as string)}>{detail.crmSyncedAt ? '已同步 CRM' : '同步 CRM'}</Button>
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 0', borderTop: '1px solid #f1f5f9' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>成交与 ROI</h4>
              <Form form={financeForm} layout="vertical" onFinish={(values) => updateMut.mutate({ id: detail.id as string, v: values })}>
                <Row gutter={12}>
                  <Col span={8}><Form.Item name="estimatedValue" label="预计金额"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={8}><Form.Item name="dealValue" label="成交金额"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={8}><Form.Item name="sourceCost" label="获客成本"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
                </Row>
                <Button size="small" onClick={() => financeForm.submit()} loading={updateMut.isPending}>保存金额</Button>
              </Form>
            </div>

            {/* 添加跟进 */}
            <div style={{ padding: '16px 0', borderTop: '1px solid #f1f5f9' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>添加跟进</h4>
              <Form form={followForm} layout="vertical" onFinish={(v) => followMut.mutate({ id: detail.id as string, v })}>
                <Form.Item name="content" label="跟进内容" rules={[{ required: true }]}><TextArea rows={2} /></Form.Item>
                <Form.Item name="result" label="结果"><Input placeholder="如：成交/待跟进/意向" /></Form.Item>
                <Button type="primary" htmlType="submit" size="small" loading={followMut.isPending}>记录</Button>
              </Form>
            </div>

            {/* 跟进记录 */}
            <div style={{ padding: '16px 0', borderTop: '1px solid #f1f5f9' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>跟进记录</h4>
              <Timeline
                items={((followUps as Record<string, unknown>[]) || []).map((f) => ({
                  children: (
                    <>
                      <div style={{ fontSize: 13, color: '#0f172a' }}>{f.content as string}</div>
                      <small style={{ color: '#94a3b8' }}>{(f.user as { name?: string })?.name} · {new Date(f.createdAt as string).toLocaleString('zh-CN')}</small>
                    </>
                  ),
                }))}
              />
            </div>
          </div>
        )}
      </Drawer>
    </PageContainer>
  );
}
