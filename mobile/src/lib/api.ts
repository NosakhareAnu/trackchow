import axios from 'axios';
import { getToken } from './auth-storage';

// Update BASE_URL to match your environment:
//   Expo web on laptop  → 'http://localhost:5000'           (browser on the same machine)
//   Android Emulator    → 'http://10.0.2.2:5000'           (localhost does NOT work on Android emulator)
//   Physical Android    → use the laptop's LAN IPv4 address (e.g. 'http://192.168.x.x:5000')
//
// Current setting: physical Android phone testing via Expo Go.
// Laptop is reachable from the phone at http://10.203.208.196:5000
const BASE_URL = 'http://10.203.208.196:5000';

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
