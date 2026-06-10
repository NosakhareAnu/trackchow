import { useRouter } from 'expo-router';
import { ChevronRight, ClipboardList, Utensils } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/lib/theme';

// Minimal bottom-sheet action menu shown when the center + tab is tapped.
// Replaces the old full-page Add screen. Two options only: Log Meal, Templates.
//
// Animation uses core React Native `Animated` (no reanimated dependency) so it
// stays rock-solid in Expo Go on a physical Android device: the backdrop fades
// and the sheet rises a short distance. Short, subtle, smooth.
export default function AddMenuSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // `rendered` keeps the Modal mounted through the closing animation.
  const [rendered, setRendered] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(anim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!rendered) return null;

  const backdropOpacity = anim;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  // Navigate to the target screen, then close the menu.
  function go(path: '/(tabs)/log-meal' | '/(tabs)/templates') {
    router.push(path);
    onClose();
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        {/* Tap outside the sheet to dismiss */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          // Claim touches on the sheet so taps on its chrome don't fall through
          // to the backdrop Pressable behind it (only an outside tap should close).
          onStartShouldSetResponder={() => true}
          style={[
            styles.sheet,
            { transform: [{ translateY }], paddingBottom: insets.bottom + spacing.lg },
          ]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Add</Text>

          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => go('/(tabs)/log-meal')}>
            <View style={styles.rowIcon}>
              <Utensils color={colors.accentSoft} size={20} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Log Meal</Text>
              <Text style={styles.rowSub}>Search and track a meal</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={20} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => go('/(tabs)/templates')}>
            <View style={styles.rowIcon}>
              <ClipboardList color={colors.accentSoft} size={20} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Templates</Text>
              <Text style={styles.rowSub}>Use a saved meal</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={20} />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  rowSub: {
    color: colors.textMuted,
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
});
