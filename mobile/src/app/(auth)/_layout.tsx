import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';

export default function AuthLayout() {
  // Dark content background avoids a white flash when navigating login ↔ register.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
