import axios from 'axios';

// pipt-flask 服务的地址
export const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
    baseURL,
    // 因为引入了多模态打标和 PIPT 实体本地校验，并发量大时后端模型推理以及Dify生成可能需要长达 1小时
    timeout: 3600000,
});

api.interceptors.response.use(
    (response) => response.data,
    (error) => {
        // 统一的错误处理
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

export default api;
