import axios from 'axios';
import { getToken } from './auth-storage';

// Change this to your machine's local IP address when testing on a physical device.
// e.g. 'http://192.168.1.x:5000'
// Leave as localhost when using an Android emulator with 10.0.2.2, or iOS simulator.
const BASE_URL = 'http://localhost:5000';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the stored Bearer token to every outgoing request
api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
