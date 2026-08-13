import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';

export interface LeadNotifyPayload {
  name: string;
  phone: string;
  demand?: string;
}

export interface NotifyResult {
  sent: boolean;
}

export interface NotifyAllResult {
  wecom: NotifyResult;
  sms: NotifyResult;
  email: NotifyResult;
}

function messageFromResponse(data: any): string {
  const nested = data?.data && typeof data.data === 'object' ? data.data : undefined;
  const result = data?.result && typeof data.result === 'object' ? data.result : undefined;
  return String(
    nested?.errmsg || nested?.message || nested?.msg || nested?.error || nested?.errorMessage
    || result?.errmsg || result?.message || result?.msg || result?.error || result?.errorMessage
    || data?.errmsg || data?.message || data?.msg || data?.error || data?.errorMessage || '服务商返回失败',
  );
}

function assertWeComSuccess(data: any) {
  if (!data || Number(data.errcode) !== 0) {
    throw new Error(`企业微信返回失败：${messageFromResponse(data)}`);
  }
}

function assertSmsSuccess(data: any) {
  if (!data) {
    throw new Error(`短信服务返回失败：${messageFromResponse(data)}`);
  }
  const layers = [data, data.data, data.result]
    .filter((value) => value && typeof value === 'object');
  const successCodes = [0, '0', 200, '200', 'OK', 'ok', 'SUCCESS', 'success'];
  for (const layer of layers) {
    const code = layer.code ?? layer.errorCode ?? layer.errcode;
    const status = String(layer.status || '').toLowerCase();
    if (layer.success === false || layer.error || ['failed', 'failure', 'error', 'rejected'].includes(status)) {
      throw new Error(`短信服务返回失败：${messageFromResponse(data)}`);
    }
    if (code !== undefined && !successCodes.includes(code)) {
      throw new Error(`短信服务返回失败：${messageFromResponse(data)}`);
    }
  }
  const confirmed = layers.some((layer) => {
    const code = layer.code ?? layer.errorCode ?? layer.errcode;
    const status = String(layer.status || '').toLowerCase();
    return layer.success === true
      || (code !== undefined && successCodes.includes(code))
      || ['ok', 'success', 'sent', 'accepted'].includes(status)
      || Boolean(layer.messageId || layer.message_id || layer.requestId || layer.request_id);
  });
  if (!confirmed) {
    throw new Error('短信服务响应缺少明确的成功标记');
  }
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private config: ConfigService) {}

  async notifyWeCom(teamId: string, lead: LeadNotifyPayload): Promise<NotifyResult> {
    const url = this.config.get<string>('WECOM_WEBHOOK_URL');
    if (!url) {
      this.logger.warn('WECOM_WEBHOOK_URL 未配置，跳过企微通知');
      return { sent: false };
    }
    try {
      const target = await prepareSafeExternalRequest(url, { requireHttps: true });
      const markdown =
        `## 新线索提醒\n` +
        `**客户**：${lead.name}\n` +
        `**电话**：${lead.phone}\n` +
        `**需求**：${lead.demand || '未填写'}\n` +
        `**团队**：${teamId}`;
      const response = await axios.post(
        target.url.toString(),
        { msgtype: 'markdown', markdown: { content: markdown } },
        { timeout: 5000, maxRedirects: 0, ...target.transport },
      );
      assertWeComSuccess(response.data);
      return { sent: true };
    } catch (err) {
      this.logger.warn(`企微通知失败：${(err as Error).message}`);
      return { sent: false };
    }
  }

  async notifySms(phone: string, content: string): Promise<NotifyResult> {
    const apiKey = this.config.get<string>('SMS_API_KEY');
    const apiUrl = this.config.get<string>('SMS_API_URL');
    if (!phone || !apiKey || !apiUrl) {
      this.logger.warn('NOTIFY_SMS_TO、SMS_API_URL 或 SMS_API_KEY 未配置，跳过短信通知');
      return { sent: false };
    }
    try {
      const target = await prepareSafeExternalRequest(apiUrl, { requireHttps: true });
      const response = await axios.post(
        target.url.toString(),
        {
          phone,
          content,
          sign: this.config.get<string>('SMS_SIGN') || '',
          template: this.config.get<string>('SMS_TEMPLATE') || '',
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 5000,
          maxRedirects: 0,
          ...target.transport,
        },
      );
      assertSmsSuccess(response.data);
      return { sent: true };
    } catch (err) {
      this.logger.warn(`短信通知失败：${(err as Error).message}`);
      return { sent: false };
    }
  }

  async notifyEmail(to: string, subject: string, body: string): Promise<NotifyResult> {
    const host = this.config.get<string>('EMAIL_SMTP_HOST');
    const port = this.config.get<number>('EMAIL_SMTP_PORT');
    const user = this.config.get<string>('EMAIL_SMTP_USER');
    const pass = this.config.get<string>('EMAIL_SMTP_PASS');
    if (!to || !host || !user || !pass) {
      this.logger.warn('EMAIL_SMTP 或收件人未配置，跳过邮件通知');
      return { sent: false };
    }
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: port || 465,
        secure: (port || 465) === 465,
        auth: { user, pass },
      });
      const info = await transporter.sendMail({ from: user, to, subject, text: body });
      const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
      if (rejected > 0 || (accepted === 0 && !info.messageId)) {
        throw new Error('SMTP 未确认收件人已接受邮件');
      }
      return { sent: true };
    } catch (err) {
      this.logger.warn(`邮件通知失败：${(err as Error).message}`);
      return { sent: false };
    }
  }

  async notifyAll(teamId: string, lead: LeadNotifyPayload): Promise<NotifyAllResult> {
    const emailTo = this.config.get<string>('NOTIFY_EMAIL_TO') || '';
    const smsTo = this.config.get<string>('NOTIFY_SMS_TO') || '';
    const [wecom, sms, email] = await Promise.all([
      this.notifyWeCom(teamId, lead).catch(() => ({ sent: false })),
      this.notifySms(smsTo, `新线索：${lead.name} ${lead.phone}`).catch(() => ({ sent: false })),
      this.notifyEmail(
        emailTo,
        '新线索提醒',
        `客户：${lead.name}\n电话：${lead.phone}\n需求：${lead.demand || '未填写'}`,
      ).catch(() => ({ sent: false })),
    ]);
    if (!wecom.sent && !sms.sent && !email.sent) {
      this.logger.warn(`线索 ${lead.name} 全部通知渠道失败`);
    }
    return { wecom, sms, email };
  }
}
