import apiClient from './apiClient';

/** 反馈表单的纯数据字段（不含文件） */
export interface FeedbackFormData {
  category: string;
  content: string;
  contact?: string;
  context_json?: Record<string, any>;
}

export interface FeedbackResponse {
  id: string;
  image_count: number;
  created_at: string;
}

/**
 * 将反馈表单数据和图片文件打包为 FormData。
 * context_json 序列化为字符串字段，images 为多文件字段。
 */
const buildFeedbackFormData = (
  formData: FeedbackFormData,
  images: File[]
): FormData => {
  const fd = new FormData();
  fd.append('category', formData.category);
  fd.append('content', formData.content);
  if (formData.contact) {
    fd.append('contact', formData.contact);
  }
  if (formData.context_json) {
    fd.append('context_json', JSON.stringify(formData.context_json));
  }
  images.forEach((file) => fd.append('images', file));
  return fd;
};

export const feedbackService = {
  async create(formData: FeedbackFormData, images: File[] = []) {
    const fd = buildFeedbackFormData(formData, images);
    // 交给浏览器自动补齐 multipart boundary，避免后端无法解析表单。
    const response = await apiClient.post<FeedbackResponse>('/feedback', fd);
    return response.data;
  },
};
