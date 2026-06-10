import { Tabs } from 'expo-router';
import { CalendarDays, Plus, User } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AddMenuSheet from '@/components/add-menu-sheet';
import { colors } from '@/lib/theme';

// Custom + button rendered in the center of the tab bar.
// It opens the Add action menu (a popup) instead of navigating to a page.
function CenterAddButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.centerWrap} onPress={onPress} hitSlop={8}>
      <View style={styles.centerBtn}>
        <Plus color="#fff" size={26} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 58 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
        }}>
        {/* Main diary/dashboard tab */}
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Diary',
            tabBarIcon: ({ color }) => <CalendarDays color={color} size={22} />,
          }}
        />

        {/* Center + action — opens the Add popup; does NOT navigate */}
        <Tabs.Screen
          name="add"
          options={{
            title: '',
            tabBarButton: () => <CenterAddButton onPress={() => setMenuOpen(true)} />,
          }}
        />

        {/* Hidden from tab bar — reached via the + popup (router.push) */}
        <Tabs.Screen name="log-meal" options={{ href: null }} />
        <Tabs.Screen name="templates" options={{ href: null }} />

        {/* Profile tab */}
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color }) => <User color={color} size={22} />,
          }}
        />
      </Tabs>

      {/* Add action menu — overlays the current screen */}
      <AddMenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Fills the center tab slot and vertically centers the button circle.
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Raised purple circle that anchors the navigation.
  centerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
});
