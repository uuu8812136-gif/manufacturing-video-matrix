import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import { systemApi } from '@/api';
import PageContainer from '@/components/PageContainer';

type CheckStatus = 'disabled' | 'missing_config' | 'configured' | 'reachable' | 'unverified' | 'failed';
interface IntegrationCheck {
  id: string;
  label: string;
  required: boolean;
  configured: boolean;
  status: CheckStatus;
  verification: 'configuration' | 'automatic' | 'manual';
  detail: string;
}
interface ReadinessReport {
  ready: boolean;
  configurationReady: boolean;
  probeReady: boolean;
  allRealModes: boolean;
  probe: boolean;
  modes: Record<string, string>;
  summary: { total: number; required: number; missing: number; unverified: number; manual: number; failed: number };
  checks: IntegrationCheck[];
  checkedAt: string;
}

const statusMeta: Record<CheckStatus, { text: string; color: string }> = {
  disabled: { text: '未启用', color: 'default' },
  missing_config: { text: '缺少配置', color: 'warning' },
  configured: { text: '已配置', color: 'processing' },
  reachable: { text: '已连通', color: 'success' },
  unverified: { text: '未验证', color: 'warning' },
  failed: { text: '连通失败', color: 'error' },
};

export default function IntegrationReadiness() {
  const query = useQuery<ReadinessReport>({
    queryKey: ['integration-readiness'],
    queryFn: () => systemApi.integrationReadiness(false),
  });
  const probe = useMutation<ReadinessReport>({ mutationFn: () => systemApi.integrationReadiness(true) });
  const report = probe.data || query.data;
  const alert = report?.ready
    ? { type: 'success' as const, message: '全部能力已切换真实模式，且所有必需自动验证均通过' }
    : report?.allRealModes && report?.configurationReady && report?.probe
      ? { type: 'error' as const, message: '真实模式尚未就绪：存在连通失败、未验证或需人工验证项' }
    : report?.allRealModes && report?.configurationReady && !report?.probe
      ? { type: 'info' as const, message: '全部真实模式配置已齐全，请执行连通检查' }
      : report?.configurationReady
        ? { type: 'warning' as const, message: '已启用的真实能力配置完整，但仍有能力处于 Mock 模式' }
        : { type: 'warning' as const, message: '尚未达到完整真实模式就绪条件' };

  const columns = [
    { title: '能力', dataIndex: 'label', width: 180 },
    { title: '要求', dataIndex: 'required', width: 90, render: (value: boolean) => value ? <Tag color="red">真实模式必需</Tag> : <Tag>可选</Tag> },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: CheckStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].text}</Tag> },
    { title: '说明', dataIndex: 'detail' },
  ];

  return (
    <PageContainer title="真实接口接入自检">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          showIcon
          type={alert.type}
          message={alert.message}
          description="“已配置”不等于接口可用；真实连通检查会验证安全、非计费的登录或状态接口。无统一探针的企业服务会标记“未验证”，不会误报就绪。"
        />
        <Card
          title={<><ApiOutlined /> 运行模式</>}
          extra={<Button type="primary" icon={<ReloadOutlined />} loading={probe.isPending} onClick={() => probe.mutate()}>执行真实连通检查</Button>}
        >
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 5 }}>
            {Object.entries(report?.modes || {}).map(([name, mode]) => (
              <Descriptions.Item key={name} label={name}>
                <Tag color={mode === 'real' ? 'green' : 'default'}>{mode}</Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
          {report && <Typography.Text type="secondary">检查时间：{new Date(report.checkedAt).toLocaleString('zh-CN')}；缺少配置 {report.summary.missing} 项，未验证 {report.summary.unverified} 项，需人工验证 {report.summary.manual} 项，连通失败 {report.summary.failed} 项。</Typography.Text>}
        </Card>
        <Card title="接入项">
          <Table<IntegrationCheck>
            rowKey="id"
            loading={query.isLoading}
            columns={columns}
            dataSource={report?.checks || []}
            pagination={false}
            scroll={{ x: 760 }}
          />
        </Card>
      </Space>
    </PageContainer>
  );
}
