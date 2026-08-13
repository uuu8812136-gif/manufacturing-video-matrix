import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, Tag, Modal, Form, Input, Select, App, Popconfirm, Card, Alert, Spin } from 'antd';
import type { TableProps } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { accountApi } from '@/api';
import type { PlatformAccountListItem } from '@/api';
import { PLATFORM_LABELS, PLATFORM_OPTIONS, PLATFORM_COLORS } from '@/constants';
import PageContainer from '@/components/PageContainer';

const INVALID_QR_IMAGE_MESSAGE = '平台未返回可扫描二维码，请重新获取';

function isScannableQrImage(imageUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(false), 5_000);

    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      const aspectRatio = height > 0 ? width / height : 0;
      finish(width >= 120 && height >= 120 && aspectRatio >= 0.8 && aspectRatio <= 1.25);
    };
    image.onerror = () => finish(false);
    image.src = imageUrl;
  });
}

export default function AccountList() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [platform, setPlatform] = useState<string>();
  const [bindOpen, setBindOpen] = useState(false);
  const [classifyAccount, setClassifyAccount] = useState<PlatformAccountListItem | null>(null);
  const [scanSession, setScanSession] = useState<{
    sessionId: string;
    qrImage: string;
    expiresIn: number;
    qrVersion: number;
    tokenHash?: string;
    qrHash?: string;
    generatedAt?: string;
  }>();
  const [scanStatus, setScanStatus] = useState('');
  const [scanPhase, setScanPhase] = useState('waiting');
  const [scanRemaining, setScanRemaining] = useState(0);
  const [scanAcknowledged, setScanAcknowledged] = useState(false);
  const scanPolling = useRef(false);
  const [form] = Form.useForm();
  const [classifyForm] = Form.useForm();
  const authType = Form.useWatch('authType', form);
  const bindPlatform = Form.useWatch('platform', form);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    let oauthPlatform = params.get('oauth_platform');
    let statePayload: { p?: string; r?: string } = {};
    if (state) {
      try {
        const base64 = state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        const binary = window.atob(padded);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        statePayload = JSON.parse(new TextDecoder().decode(bytes)) as { p?: string; r?: string };
        oauthPlatform = oauthPlatform || statePayload.p || null;
      } catch {
        oauthPlatform = null;
      }
    }
    if (code && state && oauthPlatform) {
      const redirectUri = statePayload.r || (() => {
        const value = new URL(window.location.href);
        value.searchParams.delete('code');
        value.searchParams.delete('state');
        return value.toString();
      })();
      setBindOpen(true);
      form.setFieldsValue({ platform: oauthPlatform, authType: 'oauth', credentials: code, state, redirectUri });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [form]);

  const { data, isLoading } = useQuery({
    queryKey: ['accounts', page, keyword, platform],
    queryFn: () => accountApi.list({ page, pageSize: 10, keyword, platform }),
  });
  const list = data?.list || [];
  const total = data?.total || 0;
  const { data: groupData } = useQuery({ queryKey: ['account-groups'], queryFn: accountApi.groups });
  const groupList = (groupData as Array<{ id: string; name: string }>) || [];
  const { data: regionData } = useQuery({ queryKey: ['account-regions'], queryFn: accountApi.regions });
  const regionList = (regionData as Array<{ id: string; name: string }>) || [];

  const bindMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => v.authType === 'oauth'
      ? accountApi.exchangeOAuth({
          platform: v.platform as string,
          nickname: v.nickname as string,
          code: v.credentials as string,
          state: v.state as string,
          redirectUri: v.redirectUri as string,
          groupId: v.groupId as string | undefined,
          regionId: v.regionId as string | undefined,
        })
      : accountApi.bind(v),
    onSuccess: () => { message.success('绑定成功'); setBindOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['accounts'] }); },
  });
  const authorizeMut = useMutation({
    mutationFn: () => {
      if (!bindPlatform) throw new Error('请先选择平台');
      const redirect = new URL(window.location.href);
      redirect.search = '';
      return accountApi.oauthAuthorizeUrl(bindPlatform, redirect.toString());
    },
    onSuccess: (result) => { window.location.href = result.url; },
  });

  const scanMut = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields(['platform', 'nickname', 'groupId', 'regionId', 'isDealer', 'parentAccountId']);
      return accountApi.startScan(values);
    },
    onSuccess: async (result) => {
      if (!await isScannableQrImage(result.qrImage)) {
        void accountApi.cancelScan(result.sessionId).catch(() => undefined);
        setScanSession(undefined);
        setScanPhase('failed');
        setScanRemaining(0);
        setScanAcknowledged(false);
        setScanStatus(`获取二维码失败：${INVALID_QR_IMAGE_MESSAGE}`);
        return;
      }
      setScanSession(result);
      setScanStatus('等待扫码');
      setScanPhase('waiting');
      setScanRemaining(Math.max(0, Math.floor(result.expiresIn)));
      setScanAcknowledged(false);
    },
    onError: (error: unknown) => {
      const requestError = error as {
        message?: string;
        response?: { data?: { message?: string; detail?: string } };
      };
      const detail = requestError.response?.data?.message
        || requestError.response?.data?.detail
        || requestError.message
        || '浏览器扫码服务暂时不可用';
      setScanSession(undefined);
      setScanPhase('failed');
      setScanRemaining(0);
      setScanAcknowledged(false);
      setScanStatus(`获取二维码失败：${detail}`);
    },
  });

  useEffect(() => {
    if (!scanSession) return;
    let stopped = false;
    let deadline = Date.now() + scanSession.expiresIn * 1000;
    let scanExtended = false;
    let savingExtended = false;
    let consecutivePollFailures = 0;
    const expire = (text = '二维码已过期，请重新获取') => {
      if (stopped) return;
      stopped = true;
      void accountApi.cancelScan(scanSession.sessionId).catch(() => undefined);
      setScanSession(undefined);
      setScanRemaining(0);
      setScanStatus(text);
      setScanAcknowledged(false);
      message.error(text);
    };
    const poll = async () => {
      if (stopped || scanPolling.current) return;
      scanPolling.current = true;
      try {
        const result = await accountApi.scanStatus(scanSession.sessionId);
        if (stopped) return;
        consecutivePollFailures = 0;
        setScanPhase(result.status);
        setScanStatus(result.message || result.status);
        if (
          result.qrImage
          && (result.qrVersion || 0) > scanSession.qrVersion
        ) {
          if (!await isScannableQrImage(result.qrImage)) {
            expire(INVALID_QR_IMAGE_MESSAGE);
            return;
          }
          const expiresIn = Math.max(15, result.expiresIn || scanSession.expiresIn);
          deadline = Date.now() + expiresIn * 1000;
          scanExtended = false;
          setScanRemaining(expiresIn);
          setScanAcknowledged(false);
          setScanSession({
            ...scanSession,
            qrImage: result.qrImage,
            qrVersion: result.qrVersion || scanSession.qrVersion,
            expiresIn,
            tokenHash: result.tokenHash,
            qrHash: result.qrHash,
            generatedAt: result.generatedAt,
          });
          return;
        }
        if (result.status === 'confirmed') {
          stopped = true;
          const successMessage = result.message
            || (
              result.accountPersistence === 'updated_existing'
                ? '扫码登录成功，已更新已有账号授权（未新增重复账号）'
                : '扫码登录成功，已新增账号'
            );
          if (result.accountPersistence === 'updated_existing') {
            modal.success({
              title: '该账号已登录',
              content: successMessage,
              okText: '知道了',
            });
          } else {
            message.success(successMessage);
          }
          setScanSession(undefined);
          setScanRemaining(0);
          setScanStatus('');
          setScanPhase('waiting');
          setScanAcknowledged(false);
          setBindOpen(false);
          form.resetFields();
          qc.invalidateQueries({ queryKey: ['accounts'] });
        } else if (result.status === 'scanned' || result.status === 'security_verification') {
          setScanAcknowledged(true);
          if (!scanExtended) {
            scanExtended = true;
            deadline = Date.now() + 180_000;
            setScanRemaining(180);
          }
        } else if (result.status === 'saving') {
          setScanAcknowledged(true);
          if (!savingExtended) {
            savingExtended = true;
            const savingSeconds = Math.max(60, result.expiresIn || 15 * 60);
            deadline = Date.now() + savingSeconds * 1000;
            setScanRemaining(savingSeconds);
          }
        } else if (result.status === 'failed' || result.status === 'expired') {
          expire(result.message || '二维码已失效，请重新获取');
        }
      } catch {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= 3) {
          expire('连续三次无法连接扫码服务，请重新获取二维码');
        } else {
          setScanStatus(`网络短暂波动，正在重试（${consecutivePollFailures}/3）`);
        }
      } finally {
        scanPolling.current = false;
      }
    };
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setScanRemaining(remaining);
      if (remaining <= 0) expire();
    };
    updateRemaining();
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    const countdownTimer = window.setInterval(updateRemaining, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(countdownTimer);
    };
  }, [form, message, modal, qc, scanSession]);

  const resetScanState = () => {
    setScanSession(undefined);
    setScanStatus('');
    setScanPhase('waiting');
    setScanRemaining(0);
    setScanAcknowledged(false);
  };

  const openBind = () => {
    resetScanState();
    form.resetFields();
    setBindOpen(true);
  };

  const closeBind = () => {
    const sessionId = scanSession?.sessionId;
    resetScanState();
    setBindOpen(false);
    form.resetFields();
    if (sessionId) {
      void accountApi.cancelScan(sessionId).catch(() => undefined);
    }
  };

  const refreshMut = useMutation({
    mutationFn: (id: string) => accountApi.refresh(id),
    onSuccess: (account: { status?: string; loginReason?: string }) => {
      if (account.status === 'active') {
        message.success('账号登录态和平台资料已刷新');
      } else if (account.status === 'expired') {
        message.warning('账号登录态已过期，请重新扫码登录');
      } else {
        message.warning(`账号资料已刷新，当前状态：${account.status || '未知'}`);
      }
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => accountApi.remove(id),
    onSuccess: () => { message.success('已删除'); qc.invalidateQueries({ queryKey: ['accounts'] }); },
  });
  const classifyMut = useMutation({
    mutationFn: (values: { groupId?: string; regionId?: string }) => accountApi.update(classifyAccount!.id, {
      groupId: values.groupId || null,
      regionId: values.regionId || null,
    }),
    onSuccess: () => {
      message.success('账号分组与区域已更新');
      setClassifyAccount(null);
      classifyForm.resetFields();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account-groups'] });
    },
  });

  const columns: TableProps<PlatformAccountListItem>['columns'] = [
    { title: '账号昵称', dataIndex: 'nickname', ellipsis: true },
    {
      title: '平台', dataIndex: 'platform', width: 110,
      render: (p: string) => <Tag color={PLATFORM_COLORS[p]}>{PLATFORM_LABELS[p] || p}</Tag>,
    },
    {
      title: '粉丝数',
      dataIndex: 'followerCount',
      width: 100,
      sorter: true,
      render: (n: number, account) => account.followerCountSyncedAt
        ? n.toLocaleString()
        : <span style={{ color: '#8c8c8c' }} title="平台尚未返回可验证的粉丝数">未同步</span>,
    },
    { title: '分组', dataIndex: ['group', 'name'], width: 120, render: (v: string) => v || '-' },
    { title: '区域', dataIndex: ['region', 'name'], width: 120, render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (s: string) => {
        const map: Record<string, [string, string]> = { active: ['活跃', 'success'], expired: ['已过期', 'error'], limited: ['限流', 'warning'], banned: ['封禁', 'error'] };
        const [t, c] = map[s] || [s, 'default'];
        return <Tag color={c}>{t}</Tag>;
      },
    },
    {
      title: '操作', width: 230, render: (_: unknown, r) => (
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => refreshMut.mutate(r.id)}>刷新</Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setClassifyAccount(r);
              classifyForm.setFieldsValue({ groupId: r.group?.id, regionId: r.region?.id });
            }}
          >
            归类
          </Button>
          <Popconfirm title="确定删除该账号？" onConfirm={() => delMut.mutate(r.id as string)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="账号矩阵管理">
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Input.Search
            placeholder="搜索账号昵称"
            allowClear
            style={{ width: 220 }}
            value={keyword}
            onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
            onSearch={(value) => { setKeyword(value); setPage(1); }}
          />
          <Select placeholder="平台" allowClear style={{ width: 140 }} options={PLATFORM_OPTIONS} onChange={(v) => { setPlatform(v); setPage(1); }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openBind}>绑定账号</Button>
        </Space>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
      <Modal
        title="绑定平台账号"
        open={bindOpen}
        onCancel={closeBind}
        onOk={() => authType === 'scan' ? scanMut.mutate() : form.submit()}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        okText={authType === 'scan' ? (scanSession ? '等待扫码' : (scanStatus ? '重新获取二维码' : '获取二维码')) : '确定'}
        okButtonProps={{ disabled: authType === 'scan' && Boolean(scanSession) }}
        confirmLoading={bindMut.isPending || scanMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => v.authType === 'scan' ? scanMut.mutate() : bindMut.mutate(v)}>
          <Form.Item name="platform" label="平台" rules={[{ required: true }]}>
            <Select options={PLATFORM_OPTIONS} placeholder="选择平台" disabled={Boolean(scanSession)} />
          </Form.Item>
          <Form.Item name="nickname" label="账号昵称" rules={[{ required: true }]}>
            <Input placeholder="用于系统内显示；扫码后会优先使用平台昵称" disabled={Boolean(scanSession)} />
          </Form.Item>
          <Form.Item name="authType" label="授权方式" rules={[{ required: true }]} initialValue="scan">
            <Select
              disabled={Boolean(scanSession)}
              options={[
                { value: 'scan', label: '浏览器扫码（无需开放平台 Key）' },
                { value: 'oauth', label: '官方开放平台 OAuth' },
                { value: 'cookie', label: '手工凭据' },
              ]}
            />
          </Form.Item>
          {authType === 'scan' && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="浏览器授权"
                description={bindPlatform === 'baijiahao'
                  ? '百家号是按同一机制新增的实验适配，需先完成一次真实账号扫码与低风险发布验收。'
                  : '你可以全程使用当前浏览器页面。系统会在独立服务中打开平台官方页面，并把当前有效二维码显示在这里；登录态不会返回当前浏览器前端。'}
              />
              {scanSession && (
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  {scanAcknowledged ? (
                    <>
                      <Alert
                        type={scanPhase === 'security_verification' ? 'warning' : 'success'}
                        showIcon
                        message={scanPhase === 'saving'
                          ? '登录已成功，正在保存账号'
                          : scanPhase === 'security_verification'
                            ? '抖音要求完成网页端官方身份验证'
                            : '抖音已识别本次扫码，请勿重复扫描'}
                        description={scanStatus || (scanPhase === 'saving'
                          ? '登录态已经安全保存，系统正在写入账号资料，请保持当前页面打开。'
                          : '请完成抖音官方要求的登录确认。')}
                      />
                      {scanPhase === 'security_verification' && (
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginTop: 12, textAlign: 'left' }}
                          message="请在已打开的 Edge 官方窗口完成验证"
                          description="该窗口与本次扫码使用同一官方登录会话；验证成功后系统会保存登录态并自动关闭窗口。"
                        >
                        </Alert>
                      )}
                    </>
                  ) : (
                    <img
                      src={scanSession.qrImage}
                      alt="平台登录二维码"
                      style={{ width: 260, height: 260, objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: 8 }}
                    />
                  )}
                  <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
                    二维码版本 {scanSession.qrVersion}
                    {scanSession.tokenHash ? ` · token ${scanSession.tokenHash}` : ''}
                    {scanSession.qrHash ? ` · image ${scanSession.qrHash}` : ''}
                  </div>
                  <div style={{ marginTop: 10 }}><Spin size="small" /> <span style={{ marginLeft: 8 }}>{scanStatus || '等待扫码'}（剩余 {scanRemaining} 秒）</span></div>
                </div>
              )}
              {!scanSession && scanStatus && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={scanStatus}
                  description="旧二维码已隐藏，请点击「重新获取二维码」后，再使用对应平台 App 扫码。"
                />
              )}
            </>
          )}
          {authType === 'oauth' && (
            <>
              <Button block style={{ marginBottom: 16 }} loading={authorizeMut.isPending} onClick={() => authorizeMut.mutate()}>打开官方 OAuth 授权页</Button>
              <Form.Item name="credentials" label="OAuth 授权码" rules={[{ required: true, message: '请通过上方按钮完成授权' }]}>
                <Input.TextArea rows={2} placeholder="完成授权回跳后自动填充" />
              </Form.Item>
            </>
          )}
          {authType === 'cookie' && (
            <Form.Item name="credentials" label="授权凭据" rules={[{ required: true, message: '请输入账号凭据' }]}>
              <Input.TextArea rows={2} placeholder="Cookie / Access Token（将使用 AES-256-GCM 加密存储）" />
            </Form.Item>
          )}
          <Form.Item name="state" hidden><Input /></Form.Item>
          <Form.Item name="redirectUri" hidden><Input /></Form.Item>
          <Form.Item name="isDealer" label="经销商账号" initialValue={false}>
            <Select options={[{ value: false, label: '否' }, { value: true, label: '是' }]} />
          </Form.Item>
          <Form.Item name="groupId" label="账号分组">
            <Select allowClear placeholder="选择分组" options={groupList.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <Form.Item name="regionId" label="所属区域">
            <Select allowClear placeholder="选择区域" options={regionList.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`账号归类${classifyAccount ? ` · ${classifyAccount.nickname}` : ''}`}
        open={!!classifyAccount}
        onCancel={() => { setClassifyAccount(null); classifyForm.resetFields(); }}
        onOk={() => classifyForm.submit()}
        confirmLoading={classifyMut.isPending}
      >
        <Form form={classifyForm} layout="vertical" onFinish={(values) => classifyMut.mutate(values)}>
          <Form.Item name="groupId" label="账号分组">
            <Select allowClear placeholder="未分组" options={groupList.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <Form.Item name="regionId" label="所属区域">
            <Select allowClear placeholder="未设置区域" options={regionList.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
