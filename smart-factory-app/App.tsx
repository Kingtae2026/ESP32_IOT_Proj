import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { DeviceProvider } from './context/DeviceContext';
import DashboardScreen from './screens/DashboardScreen';
import QRScreen from './screens/QRScreen';
import HistoryScreen from './screens/HistoryScreen';
import { Colors } from './config';

const Tab = createBottomTabNavigator();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { focused: IoniconName; unfocused: IoniconName }> = {
  Dashboard: { focused: 'home',     unfocused: 'home-outline'     },
  QRScanner: { focused: 'qr-code',  unfocused: 'qr-code-outline'  },
  History:   { focused: 'time',     unfocused: 'time-outline'      },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <DeviceProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                const icons = TAB_ICONS[route.name];
                const name = icons ? (focused ? icons.focused : icons.unfocused) : 'ellipse-outline';
                return <Ionicons name={name} size={size} color={color} />;
              },
              tabBarActiveTintColor:   Colors.primary,
              tabBarInactiveTintColor: '#8e8e93',
              tabBarStyle: {
                borderTopWidth: 0.5,
                borderTopColor: Colors.border,
                paddingBottom: 4,
                height: 56,
              },
              headerStyle: {
                backgroundColor: Colors.card,
                borderBottomWidth: 0.5,
                borderBottomColor: Colors.border,
                elevation: 0,
                shadowOpacity: 0,
              },
              headerTitleStyle: {
                fontSize: 16,
                fontWeight: '600',
                color: Colors.text,
              },
            })}
          >
            <Tab.Screen
              name="Dashboard"
              component={DashboardScreen}
              options={{ title: 'Dashboard', tabBarLabel: '대시보드' }}
            />
            <Tab.Screen
              name="QRScanner"
              component={QRScreen}
              options={{ title: 'QR 스캔', tabBarLabel: 'QR 스캔' }}
            />
            <Tab.Screen
              name="History"
              component={HistoryScreen}
              options={{ title: 'History', tabBarLabel: '기록' }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </DeviceProvider>
    </SafeAreaProvider>
  );
}
