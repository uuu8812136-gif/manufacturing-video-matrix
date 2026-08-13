import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Form, Select, Input, Button, App, Segmented, Space } from 'antd';
import { motion } from 'framer-motion';
import { aiApi, contentApi } from '@/api';
import PageContainer from '@/components/PageContainer';

const { TextArea } = Input;

type Mode = 'script' | 'versions' | 'title' | 'tag' | 'sensitive';

export default function AiWriting() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('script');
  const [templates, setTemplates] = useState<{ value: string; label: string; prompt: string }[]>([]);
  const [scriptRes, setScriptRes] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sensitive, setSensitive] = useState<{ hit: boolean; words: string[] } | null>(null);
  const [versions, setVersions] = useState<string[]>([]);

  useQuery({ queryKey: ['ai-templates'], queryFn: async () => { const t = await aiApi.templates(); setTemplates(t as never); return t; } });

  const scriptMut = useMutation({ mutationFn: (v: Record<string, unknown>) => aiApi.generateScript(v), onSuccess: (r) => setScriptRes((r as { content: string }).content) });
  const titleMut = useMutation({ mutationFn: (v: { topic: string }) => aiApi.generateTitles(v), onSuccess: (r) => setTitles((r as { titles: string[] }).titles) });
  const tagMut = useMutation({ mutationFn: (v: { topic: string }) => aiApi.generateTags(v), onSuccess: (r) => setTags((r as { tags: string[] }).tags) });
  const sensMut = useMutation({ mutationFn: (t: string) => aiApi.sensitiveCheck(t), onSuccess: (r) => { setSensitive(r as never); if ((r as { hit: boolean }).hit) message.warning('检测到敏感词'); else message.success('未检测到敏感词'); } });
  const versionsMut = useMutation({ mutationFn: (values: { topic: string; count?: number; style?: string }) => aiApi.multiVersions(values), onSuccess: (result) => setVersions((result as { versions: string[] }).versions) });
  const saveContent = useMutation({
    mutationFn: (body: string) => contentApi.create({
      type: 'image_text',
      title: body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 100) || 'AI 生成内容',
      body,
      tags: [],
      source: 'ai',
    }),
    onSuccess: () => {
      message.success('已保存到内容库');
      qc.invalidateQueries({ queryKey: ['contents-all'] });
    },
  });

  const accentBtn = {
    background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
    border: 'none',
    color: '#fff',
    fontWeight: 600,
    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
  } as const;

  const hasResult = (mode === 'script' && scriptRes) || (mode === 'versions' && versions.length) || (mode === 'title' && titles.length) || (mode === 'tag' && tags.length) || (mode === 'sensitive' && sensitive);

  return (
    <PageContainer title="AI 智能写作">
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, minHeight: 'calc(100vh - 180px)' }}>
        {/* 左侧输入面板 */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: '脚本', value: 'script' },
              { label: '多版本', value: 'versions' },
              { label: '标题', value: 'title' },
              { label: '标签', value: 'tag' },
              { label: '敏感词', value: 'sensitive' },
            ]}
          />

          {mode === 'script' && (
            <Form layout="vertical" onFinish={(v) => scriptMut.mutate(v)}>
              <Form.Item name="templateType" label="内容模板" rules={[{ required: true }]}>
                <Select options={templates.map((t) => ({ value: t.value, label: `${t.label}（${t.prompt}）` }))} placeholder="选择制造业提示词模板" />
              </Form.Item>
              <Form.Item name="topic" label="创作主题" rules={[{ required: true }]}><Input placeholder="如：断桥铝门窗隔音实测" /></Form.Item>
              <Form.Item name="productParams" label="产品参数（选填）"><TextArea rows={2} placeholder="型材、规格、卖点等" /></Form.Item>
              <Form.Item name="style" label="风格" initialValue="专业实用"><Input /></Form.Item>
              <Button type="primary" htmlType="submit" block loading={scriptMut.isPending} style={accentBtn}>生成脚本</Button>
            </Form>
          )}

          {mode === 'versions' && (
            <Form layout="vertical" initialValues={{ count: 3, style: '多样化' }} onFinish={(values) => versionsMut.mutate(values as { topic: string; count?: number; style?: string })}>
              <Form.Item name="topic" label="创作主题" rules={[{ required: true }]}><Input placeholder="输入同一主题，生成多个差异化版本" /></Form.Item>
              <Form.Item name="count" label="版本数量"><Select options={[3, 4, 5].map((value) => ({ value, label: `${value} 个版本` }))} /></Form.Item>
              <Form.Item name="style" label="风格方向"><Input /></Form.Item>
              <Button type="primary" htmlType="submit" block loading={versionsMut.isPending}>生成并对比</Button>
            </Form>
          )}

          {mode === 'title' && (
            <Form layout="vertical" onFinish={(v) => titleMut.mutate(v as { topic: string })}>
              <Form.Item name="topic" label="创作主题" rules={[{ required: true }]}><Input placeholder="输入主题" /></Form.Item>
              <Button type="primary" htmlType="submit" block loading={titleMut.isPending}>生成 5 个标题</Button>
            </Form>
          )}

          {mode === 'tag' && (
            <Form layout="vertical" onFinish={(v) => tagMut.mutate(v as { topic: string })}>
              <Form.Item name="topic" label="创作主题" rules={[{ required: true }]}><Input placeholder="输入主题" /></Form.Item>
              <Button type="primary" htmlType="submit" block loading={tagMut.isPending}>生成标签</Button>
            </Form>
          )}

          {mode === 'sensitive' && (
            <Form layout="vertical" onFinish={(v) => sensMut.mutate((v as { text: string }).text)}>
              <Form.Item name="text" label="待检测文本" rules={[{ required: true }]}><TextArea rows={6} placeholder="粘贴文案进行敏感词检测（8万+词库）" /></Form.Item>
              <Button type="primary" htmlType="submit" block loading={sensMut.isPending}>开始检测</Button>
            </Form>
          )}
        </motion.div>

        {/* 右侧结果区 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            padding: 24,
            minHeight: 400,
          }}
        >
          {!hasResult && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 360 }}>
              <span style={{ fontSize: 14, color: '#64748b' }}>选择模式并提交后，结果将在此显示</span>
            </div>
          )}

          {mode === 'script' && scriptRes && (
            <motion.div key={scriptRes} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#64748b' }}>生成结果</div>
                <Button size="small" loading={saveContent.isPending} onClick={() => saveContent.mutate(scriptRes)}>保存到内容库</Button>
              </Space>
              <TextArea value={scriptRes} onChange={(event) => setScriptRes(event.target.value)} autoSize={{ minRows: 12 }} style={{ fontSize: 15, lineHeight: 1.8 }} />
            </motion.div>
          )}

          {mode === 'versions' && versions.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>多版本对比（可直接修改）</div>
              {versions.map((version, index) => (
                <div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>版本 {index + 1}</div>
                    <Button size="small" loading={saveContent.isPending} onClick={() => saveContent.mutate(version)}>保存到内容库</Button>
                  </Space>
                  <TextArea value={version} onChange={(event) => setVersions((items) => items.map((item, i) => i === index ? event.target.value : item))} autoSize={{ minRows: 5 }} />
                </div>
              ))}
            </div>
          )}

          {mode === 'title' && titles.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>生成结果</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {titles.map((t, i) => (
                  <motion.div
                    key={i + t}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.06 }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <div style={{ width: 3, height: 20, borderRadius: 2, background: '#f59e0b' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }} className="tnum">{i + 1}</span>
                    <span style={{ fontSize: 15, color: '#0f172a', lineHeight: 1.5 }}>{t}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {mode === 'tag' && tags.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>生成结果</div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map((t, i) => (
                  <motion.span
                    key={i + t}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, delay: i * 0.04 }}
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      fontSize: 13,
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      background: '#fffbeb',
                      borderRadius: 6,
                    }}
                  >
                    {t}
                  </motion.span>
                ))}
              </motion.div>
            </div>
          )}

          {mode === 'sensitive' && sensitive && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 14,
                  fontWeight: 600,
                  background: sensitive.hit ? '#fef3c7' : '#ecfdf5',
                  color: sensitive.hit ? '#92400e' : '#065f46',
                }}
              >
                {sensitive.hit ? `检测到 ${sensitive.words.length} 个敏感词` : '未检测到敏感词'}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>命中词</div>
              {sensitive.words.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sensitive.words.map((w, i) => (
                    <span
                      key={i + w}
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        fontSize: 13,
                        background: '#fef3c7',
                        color: '#92400e',
                        borderRadius: 4,
                      }}
                    >
                      {w}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 14, color: '#94a3b8' }}>无</span>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
