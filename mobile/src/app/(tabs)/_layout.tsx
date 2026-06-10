import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Custom + button rendered in the center of the tab bar.
// tabBarButton receives onPress pre-wired to navigate to (tabs)/add.
function CenterAddButton({ onPress }: { onPress?: (...args: any[]) => void }) {
  return (
    <Pressable style={styles.centerWrap} onPress={onPress}>
      <View style={styles.centerBtn}>
        <Text style={styles.centerBtnText}>+</Text>
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      {/* Main diary/dashboard tab */}
      <Tabs.Screen name="dashboard" options={{ title: 'Diary' }} />

      {/* Center + action tab — navigates to the add screen */}
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarButton: (props) => <CenterAddButton onPress={props.onPress ?? undefined} />,
        }}
      />

      {/* Hidden from tab bar — accessible via router.push from add.tsx */}
      <Tabs.Screen name="log-meal" options={{ href: null }} />
      <Tabs.Screen name="templates" options={{ href: null }} />

      {/* Profile tab */}
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Fills the center tab slot and vertically centers the button circle.
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Raised blue circle that sits above the tab bar line.
  centerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  centerBtnText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '400',
    lineHeight: 32,
  },
});
