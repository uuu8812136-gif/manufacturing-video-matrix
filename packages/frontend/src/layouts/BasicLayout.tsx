import { ProLayout } from '@ant-design/pro-components';
import { Badge, Button, Dropdown, Empty, List, Popover, Spin, Typography } from 'antd';
import { BellOutlined, LogoutOutlined, SettingOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { menuConfig } from '@/menu';
import { useAuthStore } from '@/store/auth';
import { userApi, authApi, systemApi } from '@/api';
import { PageTransition } from '@/components/motion';

const { Text } = Typography;

type NotificationItem = {
  id: string;
  title: string;
  content?: string | null;
  read: boolean;
  createdAt: string;
};

function BrandLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: '-0.02em',
          boxShadow: '0 2px 8px rgba(245, 158, 11, 0.35)',
        }}
      >
        M
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>MVMS</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>制造业短视频矩阵</span>
      </div>
    </div>
  );
}

function buildRoutes(role?: string, systemAdmin?: boolean) {
  const allowed = (roles?: string[]) => !roles || (!!role && roles.includes(role));
  return {
    path: '/',
    routes: menuConfig
      .filter((group) => allowed(group.roles) && (!group.systemOnly || systemAdmin))
      .map((group) => ({
        path: group.path,
        name: group.name,
        icon: group.icon,
        routes: group.children
          .filter((item) => allowed(item.roles) && (!item.systemOnly || systemAdmin))
          .map((item) => ({ path: item.path, name: item.name, icon: item.icon })),
      }))
      .filter((group) => group.routes.length > 0),
  };
}

export default function BasicLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();
  const [loading, setLoading] = useState(!user);
  const qc = useQueryClient();
  const { data: notificationData } = useQuery({
    queryKey: ['notifications'],
    queryFn: systemApi.notifications,
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const notifications = (notificationData as NotificationItem[]) || [];
  const unreadCount = notifications.filter((item) => !item.read).length;
  const markRead = useMutation({
    mutationFn: systemApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!user) {
      userApi
        .profile()
        .then((u) => {
          useAuthStore.getState().setUser(u as never);
          setLoading(false);
        })
        .catch(() => {
          navigate('/login');
        });
    } else {
      setLoading(false);
    }
  }, [user, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ProLayout
      title=""
      logo={<BrandLogo />}
      layout="mix"
      fixedHeader
      fixSiderbar
      route={buildRoutes(user?.role, user?.systemAdmin)}
      location={{ pathname: location.pathname }}
      menuItemRender={(item, dom) => <Link to={item.path || '/'}>{dom}</Link>}
      avatarProps={{
        title: user?.name,
        size: 'small',
        render: (_, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'profile',
                  icon: <SettingOutlined />,
                  label: '个人设置',
                  onClick: () => navigate('/system/security'),
                },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: async () => {
                    await authApi.logout(refreshToken || undefined);
                    logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            {dom}
          </Dropdown>
        ),
      }}
      headerContentRender={() => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#64748b',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#10b981',
                display: 'inline-block',
              }}
            />
            在线
          </span>
          <Popover
            trigger="click"
            placement="bottomRight"
            title="通知中心"
            content={(
              <div style={{ width: 360, maxHeight: 420, overflow: 'auto' }}>
                {notifications.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" /> : (
                  <List
                    size="small"
                    dataSource={notifications}
                    renderItem={(item) => (
                      <List.Item
                        style={{ alignItems: 'flex-start', opacity: item.read ? 0.65 : 1 }}
                        actions={!item.read ? [
                          <Button key="read" type="link" size="small" loading={markRead.isPending} onClick={() => markRead.mutate(item.id)}>标为已读</Button>,
                        ] : undefined}
                      >
                        <List.Item.Meta
                          title={<Text strong={!item.read}>{item.title}</Text>}
                          description={(
                            <>
                              <div>{item.content || '—'}</div>
                              <Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
                            </>
                          )}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </div>
            )}
          >
            <Badge count={unreadCount} size="small" overflowCount={99}>
              <Button type="text" shape="circle" aria-label="通知中心" icon={<BellOutlined />} />
            </Badge>
          </Popover>
        </div>
      )}
    >
      <PageTransition key={location.pathname}>
        <Outlet />
      </PageTransition>
    </ProLayout>
  );
}
