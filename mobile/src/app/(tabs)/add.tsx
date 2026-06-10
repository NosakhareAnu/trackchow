import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AddScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.heading}>Add</Text>
        <Text style={styles.sub}>What would you like to do?</Text>

        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
          onPress={() => router.push('/(tabs)/log-meal')}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>🍽</Text>
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>Log Meal</Text>
            <Text style={styles.actionSub}>Search for a food and track what you ate</Text>
          </View>
          <Text style={styles.actionArrow}>›</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
          onPress={() => router.push('/(tabs)/templates')}>
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>📋</Text>
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>Templates</Text>
            <Text style={styles.actionSub}>Use or create a saved meal template</Text>
          </View>
          <Text style={styles.actionArrow}>›</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    gap: 16,
  },
  heading: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  sub: {
    fontSize: 15,
    color: '#555',
    marginBottom: 8,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  pressed: {
    opacity: 0.7,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconText: {
    fontSize: 22,
  },
  actionText: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  actionSub: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
  actionArrow: {
    fontSize: 22,
    color: '#aaa',
    fontWeight: '400',
  },
});
