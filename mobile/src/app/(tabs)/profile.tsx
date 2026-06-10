import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/lib/api';
import { getUser, saveUser } from '@/lib/auth-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  full_name: string;
  email: string;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  daily_calorie_goal: number | null;
  tracking_streak: number | null;
  goal_streak: number | null;
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  const [profile, setProfile] = useState<Profile | null>(null);

  // Editable field values (strings — converted to numbers before sending)
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [calorieGoal, setCalorieGoal] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // pendingUpdates holds the validated updates while waiting for the user to
  // confirm a calorie goal change in the inline warning card. Non-null means
  // the warning card is visible. This replaces Alert.alert, which does not
  // work reliably on Expo Web.
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, string | number> | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [])
  );

  async function fetchProfile() {
    setFetchError('');
    setLoading(true);
    try {
      const res = await api.get('/profile');
      const p: Profile = res.data.data;
      syncFormFromProfile(p);
    } catch (err: any) {
      setFetchError(err?.response?.data?.message ?? 'Failed to load profile. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  // Sync all local state from a Profile object returned by the server.
  function syncFormFromProfile(p: Profile) {
    setProfile(p);
    setFullName(p.full_name ?? '');
    setAge(p.age != null ? String(p.age) : '');
    setWeightKg(p.weight_kg != null ? String(p.weight_kg) : '');
    setHeightCm(p.height_cm != null ? String(p.height_cm) : '');
    setCalorieGoal(p.daily_calorie_goal != null ? String(p.daily_calorie_goal) : '');
  }

  // Build and validate updates. If the calorie goal is changing, show the
  // inline warning card instead of saving immediately.
  async function handleSave() {
    setSaveError('');
    setSaveSuccess(false);
    setPendingUpdates(null);

    const updates: Record<string, string | number> = {};

    if (fullName.trim()) {
      updates.full_name = fullName.trim();
    }

    if (age.trim()) {
      const v = parseInt(age, 10);
      if (isNaN(v) || v < 1 || v > 120) {
        setSaveError('Age must be a whole number between 1 and 120.');
        return;
      }
      updates.age = v;
    }

    if (weightKg.trim()) {
      const v = parseFloat(weightKg);
      if (isNaN(v) || v <= 0) {
        setSaveError('Weight must be a positive number (e.g. 70.5).');
        return;
      }
      updates.weight_kg = v;
    }

    if (heightCm.trim()) {
      const v = parseFloat(heightCm);
      if (isNaN(v) || v <= 0) {
        setSaveError('Height must be a positive number (e.g. 170).');
        return;
      }
      updates.height_cm = v;
    }

    if (calorieGoal.trim()) {
      const v = parseInt(calorieGoal, 10);
      if (isNaN(v) || v < 0) {
        setSaveError('Calorie goal must be 0 or more.');
        return;
      }
      updates.daily_calorie_goal = v;
    }

    if (Object.keys(updates).length === 0) {
      setSaveError('No changes to save.');
      return;
    }

    // If the calorie goal is changing from an existing value, show the inline
    // warning card. The user must Confirm or Cancel before anything is saved.
    const newGoal = updates.daily_calorie_goal as number | undefined;
    const oldGoal = profile?.daily_calorie_goal;
    if (newGoal !== undefined && oldGoal != null && newGoal !== oldGoal) {
      setPendingUpdates(updates); // shows the warning card — save is paused
      return;
    }

    // No warning needed — save straight away.
    await performSave(updates);
  }

  // Called when the user taps Confirm on the inline goal-change warning card.
  async function confirmGoalChange() {
    if (!pendingUpdates) return;
    const updates = pendingUpdates;
    setPendingUpdates(null);
    await performSave(updates);
  }

  // Called when the user taps Cancel on the inline goal-change warning card.
  function cancelGoalChange() {
    setPendingUpdates(null);
    setSaveError('Calorie goal change cancelled. Nothing was saved.');
  }

  // Sends the PUT request and syncs the form from the server response.
  async function performSave(updates: Record<string, string | number>) {
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.put('/profile', updates);
      const updated: Profile = res.data.data;

      syncFormFromProfile(updated);

      // Keep the cached user name in sync so the Diary greeting reflects changes.
      if (updates.full_name) {
        const stored = await getUser();
        if (stored) await saveUser({ ...stored, full_name: updated.full_name });
      }

      setSaveSuccess(true);
    } catch (err: any) {
      setSaveError(err?.response?.data?.message ?? 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Profile</Text>

        {fetchError ? <Text style={styles.error}>{fetchError}</Text> : null}

        {/* Streak summary */}
        <View style={styles.streakRow}>
          <View style={styles.streakBox}>
            <Text style={styles.streakValue}>{profile?.tracking_streak ?? 0}</Text>
            <Text style={styles.streakLabel}>Tracking Streak</Text>
            <Text style={styles.streakUnit}>days</Text>
          </View>
          <View style={styles.streakDivider} />
          <View style={styles.streakBox}>
            <Text style={styles.streakValue}>{profile?.goal_streak ?? 0}</Text>
            <Text style={styles.streakLabel}>Goal Streak</Text>
            <Text style={styles.streakUnit}>days</Text>
          </View>
        </View>

        {/* Email — read-only */}
        <Text style={styles.label}>Email</Text>
        <View style={styles.readonlyField}>
          <Text style={styles.readonlyText}>{profile?.email ?? '—'}</Text>
        </View>

        {/* Full name */}
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={(v) => { setFullName(v); setSaveSuccess(false); }}
          placeholder="Your full name"
          placeholderTextColor="#999"
          autoCapitalize="words"
        />

        {/* Age */}
        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          value={age}
          onChangeText={(v) => { setAge(v); setSaveSuccess(false); }}
          placeholder="e.g. 21"
          placeholderTextColor="#999"
          keyboardType="number-pad"
        />

        {/* Weight */}
        <Text style={styles.label}>Weight (kg)</Text>
        <TextInput
          style={styles.input}
          value={weightKg}
          onChangeText={(v) => { setWeightKg(v); setSaveSuccess(false); }}
          placeholder="e.g. 70.5"
          placeholderTextColor="#999"
          keyboardType="decimal-pad"
        />

        {/* Height */}
        <Text style={styles.label}>Height (cm)</Text>
        <TextInput
          style={styles.input}
          value={heightCm}
          onChangeText={(v) => { setHeightCm(v); setSaveSuccess(false); }}
          placeholder="e.g. 170"
          placeholderTextColor="#999"
          keyboardType="decimal-pad"
        />

        {/* Daily calorie goal */}
        <Text style={styles.label}>Daily Calorie Goal (kcal)</Text>
        <TextInput
          style={styles.input}
          value={calorieGoal}
          onChangeText={(v) => { setCalorieGoal(v); setSaveSuccess(false); }}
          placeholder="e.g. 2000"
          placeholderTextColor="#999"
          keyboardType="number-pad"
        />

        {/* Inline goal-change warning — shown instead of Alert.alert when the
            calorie goal changes, because Alert.alert is unreliable on Expo Web. */}
        {pendingUpdates !== null ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              Changing your calorie goal will reset your goal streak. Continue?
            </Text>
            <View style={styles.warningButtons}>
              <Pressable
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                onPress={cancelGoalChange}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
                onPress={confirmGoalChange}>
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        {saveSuccess ? <Text style={styles.success}>Profile saved successfully.</Text> : null}

        {/* Hide the Save button while the warning card is open so the user must
            choose Confirm or Cancel before doing anything else. */}
        {pendingUpdates === null ? (
          <Pressable
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
            onPress={handleSave}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  streakRow: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  streakBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 2,
  },
  streakDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 10,
  },
  streakValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  streakLabel: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
    textAlign: 'center',
  },
  streakUnit: {
    fontSize: 11,
    color: '#888',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 6,
  },
  readonlyField: {
    backgroundColor: '#F5F5F7',
    borderRadius: 8,
    padding: 12,
  },
  readonlyText: {
    fontSize: 15,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#000',
    backgroundColor: '#fff',
  },
  warningCard: {
    backgroundColor: '#FFF3CD',
    borderColor: '#F0A500',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 12,
    marginTop: 8,
  },
  warningText: {
    fontSize: 14,
    color: '#7A4F00',
    lineHeight: 20,
  },
  warningButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    color: '#333',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    color: '#c0392b',
    fontSize: 13,
    marginTop: 4,
  },
  success: {
    color: '#16a34a',
    fontSize: 13,
    marginTop: 4,
  },
});
