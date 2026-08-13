import { useQuery } from '@tanstack/react-query';
import { Empty, Spin, Table } from 'antd';
import { motion } from 'framer-motion';
import { dataApi, hitApi } from '@/api';
import LineBarChart from '@/components/charts/LineBarChart';
import PageContainer from '@/components/PageContainer';
import { CountUp } from '@/components/motion';
import { getBaseEchartsOption } from '@/theme/echarts';

export default function Dashboard() {
  const { data: overview, isLoading } = useQuery({ queryKey: ['overview'], queryFn: dataApi.overview });
  const { data: trend } = useQuery({ queryKey: ['trend', 7], queryFn: () => dataApi.trend(7) });
  const { data: flywheel } = useQuery({ queryKey: ['flywheel'], queryFn: hitApi.flywheel });
  const { data: ranking } = useQuery({ queryKey: ['ranking'], queryFn: dataApi.ranking });

  const o = (overview || {}) as Record<string, number>;
  const f = (flywheel || {}) as { totalRecreations?: number; flywheelLevel?: string | null };
  const trendData = (trend || []) as Array<{ date: string; play: number; fan: number }>;

  const kpis = [
    { label: '矩阵账号数', value: o.accountCount || 0, accent: false },
    { label: '累计播放量', value: o.totalPlay || 0, accent: true },
    {
      label: '当前总粉丝数',
      value: o.totalFan || 0,
      accent: false,
      hint: `${o.followerSyncedAccountCount || 0}/${o.accountCount || 0} 个账号已同步`,
    },
    { label: '累计点赞数', value: o.totalLike || 0, accent: false },
  ];

  const trendOption = {
    ...getBaseEchartsOption(),
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.92)', borderColor: 'transparent', textStyle: { color: '#fff', fontSize: 13 } },
    legend: { data: ['播放量', '粉丝数'], top: 0, right: 0, textStyle: { color: '#64748b' } },
    xAxis: { type: 'category', data: trendData.map((t) => t.date), axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { color: '#64748b', fontSize: 12 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: '#64748b', fontSize: 12 }, splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } } },
    series: [
      {
        name: '播放量',
        type: 'line',
        smooth: true,
        data: trendData.map((t) => t.play),
        areaStyle: { gradient: { x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(26, 43, 74, 0.18)' }, { offset: 1, color: 'rgba(26, 43, 74, 0)' }] } },
        lineStyle: { color: '#1a2b4a', width: 2 },
        itemStyle: { color: '#1a2b4a' },
      },
      {
        name: '粉丝数',
        type: 'line',
        smooth: true,
        data: trendData.map((t) => t.fan),
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
  };

  const rankingData = (ranking || []) as Array<{
    id: string;
    nickname: string;
    platform: string;
    followerCount: number;
    followerCountSyncedAt?: string | null;
    playCount: number;
    likeCount: number;
  }>;

  return (
    <PageContainer title="工作台">
      <Spin spinning={isLoading}>
        {/* KPI 区 - 极简竖线列表式 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            marginBottom: 24,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              style={{
                padding: '20px 24px',
                borderRight: i < 3 ? '1px solid #f1f5f9' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    background: kpi.accent ? '#f59e0b' : '#1a2b4a',
                  }}
                />
                <span style={{ fontSize: 13, color: '#64748b' }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#0f172a', lineHeight: 1 }} className="tnum">
                <CountUp value={kpi.value} />
              </div>
              {kpi.hint && <span style={{ fontSize: 12, color: '#94a3b8' }}>{kpi.hint}</span>}
            </motion.div>
          ))}
        </div>

        {/* 趋势图 + 飞轮 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>近 7 天数据趋势</h3>
              <span style={{ fontSize: 12, color: '#64748b' }}>播放量 vs 粉丝增长</span>
            </div>
            {trendData.length > 0
              ? <LineBarChart option={trendOption} style={{ height: 280 }} />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实趋势数据" style={{ margin: '84px 0' }} />}
          </div>

          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0, marginBottom: 16 }}>数据飞轮</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>二创内容数</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }} className="tnum">
                  <CountUp value={f.totalRecreations || 0} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>飞轮阶段</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{f.flywheelLevel || '-'}</div>
              </div>
              <div style={{ marginTop: 'auto', padding: '12px 16px', background: '#f7f8fa', borderRadius: 8, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                仅汇总已同步的真实平台数据；未同步账号会明确标注，不把默认 0 当作真实值。
              </div>
            </div>
          </div>
        </div>

        {/* 账号排名 */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0, marginBottom: 16 }}>账号影响力排行</h3>
          <Table
            dataSource={rankingData}
            rowKey="id"
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无真实账号数据' }}
            columns={[
              {
                title: '#',
                width: 48,
                render: (_, __, i) => <span style={{ color: i < 3 ? '#f59e0b' : '#94a3b8', fontWeight: 700 }} className="tnum">{i + 1}</span>,
              },
              { title: '账号', dataIndex: 'nickname', render: (v) => <span style={{ fontWeight: 500 }}>{v}</span> },
              { title: '平台', dataIndex: 'platform', width: 100, render: (v) => <span style={{ color: '#64748b', textTransform: 'capitalize' }}>{v}</span> },
              {
                title: '粉丝数',
                dataIndex: 'followerCount',
                width: 120,
                align: 'right' as const,
                render: (value, account) => account.followerCountSyncedAt
                  ? <span className="tnum">{value.toLocaleString()}</span>
                  : <span style={{ color: '#94a3b8' }}>未同步</span>,
              },
              { title: '播放量', dataIndex: 'playCount', width: 120, align: 'right' as const, render: (v) => <span className="tnum">{v?.toLocaleString()}</span> },
              { title: '点赞数', dataIndex: 'likeCount', width: 120, align: 'right' as const, render: (v) => <span className="tnum" style={{ color: '#f59e0b' }}>{v?.toLocaleString()}</span> },
            ]}
          />
        </div>
      </Spin>
    </PageContainer>
  );
}
