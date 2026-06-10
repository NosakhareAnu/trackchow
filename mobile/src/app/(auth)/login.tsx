import { Link, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogIn, Lock, Mail, Utensils } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/lib/api';
import { saveToken, saveUser, StoredUser } from '@/lib/auth-storage';
import { colors, radius, spacing } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/login', { email: email.trim(), password });
      const { token, data } = response.data;

      await saveToken(token);
      await saveUser(data as StoredUser);

      router.replace('/(tabs)/dashboard');
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Login failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Brand */}
          <View style={styles.brandMark}>
            <Utensils color={colors.accentSoft} size={26} />
          </View>
          <Text style={styles.title}>TrackChow</Text>
          <Text style={styles.subtitle}>Track your meals, calories, and local foods.</Text>

          {/* Auth card */}
          <View style={styles.card}>
            <View style={styles.inputWrap}>
              <Mail color={colors.textMuted} size={18} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputWrap}>
              <Lock color={colors.textMuted} size={18} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.placeholder}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={handleLogin}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.buttonContent}>
                  <LogIn color="#fff" size={18} />
                  <Text style={styles.buttonText}>Log In</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Switch to register */}
          <View style={styles.linkRow}>
            <Text style={styles.linkMuted}>Don&apos;t have an account? </Text>
            <Link href="/(auth)/register" style={styles.linkAccent}>
              Register
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 32,
  },
  brandMark: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accentFill,
    borderWidth: 1,
    borderColor: 'rgba(139,128,249,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.textPrimary,
  },
  errorCard: {
    backgroundColor: colors.dangerFill,
    borderWidth: 1,
    borderColor: 'rgba(224,106,106,0.4)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  linkMuted: {
    color: colors.textMuted,
    fontSize: 14,
  },
  linkAccent: {
    color: colors.accentSoft,
    fontSize: 14,
    fontWeight: '600',
  },
});
