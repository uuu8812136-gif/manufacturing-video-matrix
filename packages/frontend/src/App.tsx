import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from '@/store/auth';

const BasicLayout = lazy(() => import('@/layouts/BasicLayout'));
const Login = lazy(() => import('@/pages/login'));
const Register = lazy(() => import('@/pages/register'));
const PublicLeadForm = lazy(() => import('@/pages/public/LeadForm'));
const Dashboard = lazy(() => import('@/pages/dashboard'));
const AccountList = lazy(() => import('@/pages/accounts/AccountList'));
const AccountGroups = lazy(() => import('@/pages/accounts/AccountGroups'));
const DealerMatrix = lazy(() => import('@/pages/accounts/DealerMatrix'));
const Publish = lazy(() => import('@/pages/distribution/Publish'));
const Contents = lazy(() => import('@/pages/distribution/Contents'));
const PublishTasks = lazy(() => import('@/pages/distribution/PublishTasks'));
const AiWriting = lazy(() => import('@/pages/ai-creation/AiWriting'));
const Mixcut = lazy(() => import('@/pages/ai-creation/Mixcut'));
const Tts = lazy(() => import('@/pages/ai-creation/Tts'));
const Extract = lazy(() => import('@/pages/ai-creation/Extract'));
const Materials = lazy(() => import('@/pages/ai-creation/Materials'));
const ProductLibrary = lazy(() => import('@/pages/product-library/ProductLibrary'));
const DigitalHumanIp = lazy(() => import('@/pages/digital-human/DigitalHumanIp'));
const DhGenerate = lazy(() => import('@/pages/digital-human/DhGenerate'));
const GeoKeywords = lazy(() => import('@/pages/geo/GeoKeywords'));
const GeoTracking = lazy(() => import('@/pages/geo/GeoTracking'));
const DualEngine = lazy(() => import('@/pages/geo/DualEngine'));
const DataOverview = lazy(() => import('@/pages/data-center/DataOverview'));
const AccountData = lazy(() => import('@/pages/data-center/AccountData'));
const EmployeeData = lazy(() => import('@/pages/data-center/EmployeeData'));
const ContentData = lazy(() => import('@/pages/data-center/ContentData'));
const HotTopics = lazy(() => import('@/pages/data-center/HotTopics'));
const LeadPool = lazy(() => import('@/pages/leads/LeadPool'));
const Comments = lazy(() => import('@/pages/leads/Comments'));
const LeadForms = lazy(() => import('@/pages/leads/LeadForms'));
const Attribution = lazy(() => import('@/pages/leads/Attribution'));
const CrmConfig = lazy(() => import('@/pages/leads/CrmConfig'));
const Reviews = lazy(() => import('@/pages/team/Reviews'));
const Tasks = lazy(() => import('@/pages/team/Tasks'));
const Calendar = lazy(() => import('@/pages/team/Calendar'));
const Performance = lazy(() => import('@/pages/team/Performance'));
const Workbench = lazy(() => import('@/pages/hit-recreation/Workbench'));
const Hits = lazy(() => import('@/pages/hit-recreation/Hits'));
const Peers = lazy(() => import('@/pages/hit-recreation/Peers'));
const Flywheel = lazy(() => import('@/pages/hit-recreation/Flywheel'));
const ChannelList = lazy(() => import('@/pages/channel/ChannelList'));
const ChannelReport = lazy(() => import('@/pages/channel/ChannelReport'));
const Members = lazy(() => import('@/pages/system/Members'));
const Security = lazy(() => import('@/pages/system/Security'));
const AuditLogs = lazy(() => import('@/pages/system/AuditLogs'));
const Backups = lazy(() => import('@/pages/system/Backups'));
const IntegrationReadiness = lazy(() => import('@/pages/system/IntegrationReadiness'));

function Protected({
  children,
  roles,
  systemOnly = false,
}: {
  children: React.ReactNode;
  roles?: string[];
  systemOnly?: boolean;
}) {
  const { accessToken: token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if ((roles && (!user || !roles.includes(user.role))) || (systemOnly && !user?.systemAdmin)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Spin size="large" /></div>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/lead/:formId" element={<PublicLeadForm />} />
      <Route
        path="/"
        element={
          <Protected>
            <BasicLayout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="accounts" element={<AccountList />} />
        <Route path="accounts/groups" element={<AccountGroups />} />
        <Route path="accounts/dealer" element={<DealerMatrix />} />
        <Route path="distribution/publish" element={<Publish />} />
        <Route path="distribution/contents" element={<Contents />} />
        <Route path="distribution/tasks" element={<PublishTasks />} />
        <Route path="ai-creation/writing" element={<AiWriting />} />
        <Route path="ai-creation/mixcut" element={<Mixcut />} />
        <Route path="ai-creation/tts" element={<Tts />} />
        <Route path="ai-creation/extract" element={<Extract />} />
        <Route path="ai-creation/materials" element={<Materials />} />
        <Route path="product-library" element={<ProductLibrary />} />
        <Route path="digital-human" element={<DigitalHumanIp />} />
        <Route path="digital-human/generate" element={<DhGenerate />} />
        <Route path="geo/keywords" element={<GeoKeywords />} />
        <Route path="geo/tracking" element={<GeoTracking />} />
        <Route path="geo/dual-engine" element={<DualEngine />} />
        <Route path="data-center" element={<DataOverview />} />
        <Route path="data-center/accounts" element={<AccountData />} />
        <Route path="data-center/contents" element={<ContentData />} />
        <Route path="data-center/employee" element={<EmployeeData />} />
        <Route path="data-center/hot-topics" element={<HotTopics />} />
        <Route path="leads/pool" element={<LeadPool />} />
        <Route path="leads/comments" element={<Comments />} />
        <Route path="leads/forms" element={<LeadForms />} />
        <Route path="leads/attribution" element={<Attribution />} />
        <Route path="leads/crm" element={<CrmConfig />} />
        <Route path="team/reviews" element={<Reviews />} />
        <Route path="team/tasks" element={<Tasks />} />
        <Route path="team/calendar" element={<Calendar />} />
        <Route path="team/performance" element={<Protected roles={['super_admin', 'ops_lead']}><Performance /></Protected>} />
        <Route path="hit-recreation/workbench" element={<Workbench />} />
        <Route path="hit-recreation/hits" element={<Hits />} />
        <Route path="hit-recreation/peers" element={<Peers />} />
        <Route path="hit-recreation/flywheel" element={<Flywheel />} />
        <Route path="channel" element={<Protected roles={['super_admin']} systemOnly><ChannelList /></Protected>} />
        <Route path="channel/report" element={<Protected roles={['super_admin']} systemOnly><ChannelReport /></Protected>} />
        <Route path="system/members" element={<Protected roles={['super_admin', 'ops_lead']}><Members /></Protected>} />
        <Route path="system/security" element={<Security />} />
        <Route path="system/logs" element={<Protected roles={['super_admin', 'ops_lead']}><AuditLogs /></Protected>} />
        <Route path="system/integrations" element={<Protected roles={['super_admin']} systemOnly><IntegrationReadiness /></Protected>} />
        <Route path="system/backups" element={<Protected roles={['super_admin']} systemOnly><Backups /></Protected>} />
      </Route>
    </Routes>
    </Suspense>
  );
}
