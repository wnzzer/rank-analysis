import axios from "axios";

// src/services/http.ts
export const assetPrefix = "http://127.0.0.1:11451/v1/GetAsset?key="
const http = axios.create({
  baseURL: 'http://127.0.0.1:11451/v1/', // 替换为你的接口基础路径
  timeout: 50000, // 请求超时时间
});



// 响应拦截器
http.interceptors.response.use(
  (response) => {
    return response; // 直接返回数据部分
  },
  (error) => {
    // 在这里可以处理全局错误，比如跳转登录页面
    console.error('Request Error:', error);
    return Promise.reject(error);
  }
);

export default http;
