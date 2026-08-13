import { ReactNode } from 'react';
import { PageContainer as ProPageContainer } from '@ant-design/pro-components';
import { PageTransition } from './motion';

export default function PageContainer({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <ProPageContainer
      header={{
        title: title ? <span style={{ fontSize: 20, fontWeight: 600 }}>{title}</span> : undefined,
        breadcrumb: {},
      }}
      ghost
      style={{ padding: 0 }}
    >
      <PageTransition>
        <div style={{ padding: 16 }}>{children}</div>
      </PageTransition>
    </ProPageContainer>
  );
}
