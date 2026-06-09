import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { getToken } from '@/lib/auth-storage';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  // On first load, check for a stored token and redirect to the right screen.
  // After this, each screen handles its own navigation (login → dashboard, logout → login).
  useEffect(() => {
    getToken().then((token) => {
      if (token) {
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/(auth)/login');
      }
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
