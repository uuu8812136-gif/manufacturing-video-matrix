import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/store/auth';

const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing = false;
let queue: Array<{
  resolve: (accessToken: string) => void;
  reject: (error: unknown) => void;
}> = [];

client.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 0) {
        return data.data;
      }
      message.error(data.message || '请求失败');
      return Promise.reject(new Error(data.message || '请求失败'));
    }
    return data;
  },
  async (error) => {
    const original = error.config;
    const isInteractiveAuthRequest = ['/auth/login', '/auth/mfa/verify'].some((path) =>
      typeof original?.url === 'string' && original.url.includes(path),
    );
    if (error.response?.status === 401 && isInteractiveAuthRequest) {
      const msg = error.response?.data?.message || '手机号或密码错误';
      message.error(msg);
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && !original._retry) {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken && !refreshing) {
        refreshing = true;
        original._retry = true;
        try {
          const res = await axios.post('/api/auth/refresh', { refreshToken });
          const tokens = res.data.data;
          useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);
          queue.forEach((item) => item.resolve(tokens.accessToken));
          queue = [];
          original.headers.Authorization = `Bearer ${tokens.accessToken}`;
          return client(original);
        } catch (refreshError) {
          queue.forEach((item) => item.reject(refreshError));
          queue = [];
          useAuthStore.getState().logout();
          window.location.href = '/login';
          return Promise.reject(refreshError);
        } finally {
          refreshing = false;
        }
      } else if (refreshing) {
        original._retry = true;
        return new Promise<string>((resolve, reject) => {
          queue.push({ resolve, reject });
        }).then((accessToken) => {
          original.headers.Authorization = `Bearer ${accessToken}`;
          return client(original);
        });
      } else {
        useAuthStore.getState().logout();
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }
    const msg = error.response?.data?.message || error.message || '网络错误';
    if (error.response?.status !== 401) message.error(msg);
    return Promise.reject(error);
  },
);

// 类型化客户端：拦截器已解包 response.data，这里覆盖类型让方法直接返回 Promise<T>
export interface TypedClient {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  patch<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
}

const typedClient = client as unknown as TypedClient;

export default typedClient;
