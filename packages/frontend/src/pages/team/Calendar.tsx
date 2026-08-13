import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Calendar as AntCalendar, Badge, Modal, Form, Input, DatePicker, Select, App } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { accountApi, contentApi, teamApi } from '@/api';
import { PLATFORM_LABELS, PLATFORM_OPTIONS } from '@/constants';
import PageContainer from '@/components/PageContainer';

export default function Calendar() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [date, setDate] = useState<Dayjs>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data } = useQuery({ queryKey: ['calendar', month], queryFn: () => teamApi.calendar(month) });
  const events = (data as { scheduledAt: string; title: string; platform?: string }[]) || [];
  const { data: contents } = useQuery({ queryKey: ['calendar-contents'], queryFn: () => contentApi.list({ page: 1, pageSize: 100 }) });
  const contentList = (contents as { list?: Record<string, unknown>[] })?.list || [];
  const { data: accounts } = useQuery({ queryKey: ['calendar-accounts'], queryFn: () => accountApi.list({ page: 1, pageSize: 100, status: 'active' }) });
  const accountList = (accounts as { list?: Record<string, unknown>[] })?.list || [];
  const selectedPlatform = Form.useWatch('platform', form);
  const selectableAccounts = accountList.filter(
    (item) => !selectedPlatform || item.platform === selectedPlatform,
  );

  const mut = useMutation({ mutationFn: (v: Record<string, unknown>) => teamApi.createCalendar({ ...v, scheduledAt: (v.scheduledAt as Dayjs).toISOString() }), onSuccess: () => { message.success('已添加'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['calendar'] }); } });

  const cellRender = (value: Dayjs) => {
    const dayEvents = events.filter((e) => dayjs(e.scheduledAt).isSame(value, 'day'));
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {dayEvents.map((e, i) => <li key={i}><Badge status="processing" text={<span style={{ fontSize: 12 }}>{e.title}</span>} /></li>)}
      </ul>
    );
  };

  return (
    <PageContainer title="内容日历">
      <Card>
        <AntCalendar cellRender={cellRender} onPanelChange={(d) => setMonth(d.format('YYYY-MM'))} onSelect={(d) => { setDate(d); form.setFieldsValue({ scheduledAt: d }); setOpen(true); }} />
      </Card>
      <Modal title={`添加内容排期 ${date?.format('YYYY-MM-DD') || ''}`} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={mut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="platform" label="平台">
            <Select
              options={PLATFORM_OPTIONS}
              allowClear
              onChange={() => form.setFieldValue('accountIds', [])}
            />
          </Form.Item>
          <Form.Item name="contentId" label="关联内容"><Select allowClear showSearch optionFilterProp="label" options={contentList.map((item) => ({ value: item.id as string, label: item.title as string }))} /></Form.Item>
          <Form.Item name="accountIds" label="发布账号（关联内容后可定时发布）">
            <Select
              mode="multiple"
              allowClear
              options={selectableAccounts.map((item) => ({
                value: item.id as string,
                label: `${item.nickname as string} · ${PLATFORM_LABELS[item.platform as string] || item.platform}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="scheduledAt" label="时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
