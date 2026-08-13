import { useQuery } from '@tanstack/react-query';
import { Empty, Spin, Button } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { dataApi } from '@/api';
import LineBarChart from '@/components/charts/LineBarChart';
import PageContainer from '@/components/PageContainer';
import { CountUp } from '@/components/motion';
import { getBaseEchartsOption } from '@/theme/echarts';
import { downloadBlob } from '@/utils/download';

export default function DataOverview() {
  const { data: overview, isLoading } = useQuery({ queryKey: ['overview'], queryFn: dataApi.overview });
  const { data: trend } = useQuery({ queryKey: ['trend', 30], queryFn: () => dataApi.trend(30) });
  const { data: ranking } = useQuery({ queryKey: ['ranking'], queryFn: dataApi.ranking });
  const o = (overview || {}) as Record<string, number>;
  const trendData = (trend || []) as Array<{ date: string; play: number; like: number }>;

  const handleExport = async () => {
    const blob = await dataApi.export();
    downloadBlob(blob, 'account-data.xlsx');
  };

  const metrics = [
    { label: '账号数', value: o.accountCount || 0, accent: false },
    { label: '累计播放', value: o.totalPlay || 0, accent: true },
    { label: '累计阅读', value: o.totalRead || 0, accent: false },
    {
      label: '当前总粉丝',
      value: o.totalFan || 0,
      accent: false,
      hint: `${o.followerSyncedAccountCount || 0}/${o.accountCount || 0} 个账号已同步`,
    },
    { label: '累计互动', value: (o.totalLike || 0) + (o.totalComment || 0) + (o.totalShare || 0), accent: false },
    { label: '累计收益', value: o.revenue || 0, accent: false, prefix: '¥', decimals: 2 },
  ];

  const trendOption = {
    ...getBaseEchartsOption(),
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.92)', borderColor: 'transparent', textStyle: { color: '#fff', fontSize: 13 } },
    legend: { data: ['播放量', '点赞数'], top: 0, right: 0, textStyle: { color: '#64748b' } },
    xAxis: { type: 'category', data: trendData.map((t) => t.date), axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { color: '#64748b', fontSize: 11 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: '#64748b', fontSize: 12 }, splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } } },
    series: [
      { name: '播放量', type: 'bar', data: trendData.map((t) => t.play), itemStyle: { color: '#1a2b4a', borderRadius: [4, 4, 0, 0] }, barWidth: '50%' },
      { name: '点赞数', type: 'line', smooth: true, data: trendData.map((t) => t.like), lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' } },
    ],
  };

  const top10 = ((ranking as Array<{ nickname: string; playCount: number }>) || []).slice(0, 10);
  const maxPlay = Math.max(...top10.map((r) => r.playCount || 0), 1);

  return (
    <PageContainer title="数据总览">
      <Spin spinning={isLoading}>
        {/* 6 指标分区 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0,
            marginBottom: 24,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          {metrics.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              style={{
                padding: '20px 24px',
                borderRight: i % 3 < 2 ? '1px solid #f1f5f9' : 'none',
                borderBottom: i < 3 ? '1px solid #f1f5f9' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div
                  style={{
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    background: m.accent ? '#f59e0b' : '#1a2b4a',
                  }}
                />
                <span style={{ fontSize: 13, color: '#64748b' }}>{m.label}</span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: m.accent ? '#f59e0b' : '#0f172a' }} className="tnum">
                {m.prefix || ''}
                {m.decimals ? (m.value).toFixed(m.decimals) : <CountUp value={m.value} />}
              </div>
              {m.hint && <div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>{m.hint}</div>}
            </motion.div>
          ))}
        </div>

        {/* 趋势图 */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>近 30 天趋势</h3>
            <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
          </div>
          {trendData.length > 0
            ? <LineBarChart option={trendOption} style={{ height: 300 }} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实趋势数据" style={{ margin: '94px 0' }} />}
        </div>

        {/* TOP10 极简列表条 */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0, marginBottom: 16 }}>账号播放量 TOP 10</h3>
          {top10.length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无真实账号排行" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {top10.map((r, i) => (
              <motion.div
                key={r.nickname + i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <span
                  style={{
                    width: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    color: i < 3 ? '#f59e0b' : '#94a3b8',
                    textAlign: 'center',
                  }}
                  className="tnum"
                >
                  {i + 1}
                </span>
                <span style={{ width: 140, fontSize: 13, color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.nickname}
                </span>
                <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(r.playCount / maxPlay) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.2 + i * 0.04, ease: [0.4, 0, 0.2, 1] }}
                    style={{ height: '100%', background: i < 3 ? 'linear-gradient(90deg, #f59e0b, #f97316)' : '#1a2b4a', borderRadius: 4 }}
                  />
                </div>
                <span style={{ width: 90, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#0f172a' }} className="tnum">
                  {(r.playCount || 0).toLocaleString()}
                </span>
              </motion.div>
              ))}
            </div>}
        </div>
      </Spin>
    </PageContainer>
  );
}
