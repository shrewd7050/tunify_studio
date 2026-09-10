import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MaterialIcons } from "@expo/vector-icons";

import RecordScreen from "./src/screens/RecordScreen";
import ProcessScreen from "./src/screens/ProcessScreen";
import ResultsScreen from "./src/screens/ResultsScreen";
import GenerateScreen from "./src/screens/GenerateScreen";
import EffectsScreen from "./src/screens/EffectsScreen";
import VoiceSwapScreen from "./src/screens/VoiceSwapScreen";
import StudioScreen from "./src/screens/StudioScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0a0a12",
          borderTopWidth: 1,
          borderTopColor: "rgba(168, 85, 247, 0.1)",
          height: 70,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: "#A855F7",
        tabBarInactiveTintColor: "#4B5563",
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          tabBarIcon: ({ color, size }) => <MaterialIcons name="mic" size={24} color={color} />,
        }}
      />
      <Tab.Screen
        name="VoiceSwap"
        component={VoiceSwapScreen}
        options={{
          tabBarIcon: ({ color, size }) => <MaterialIcons name="swap-horiz" size={24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Generate"
        component={GenerateScreen}
        options={{
          tabBarIcon: ({ color, size }) => <MaterialIcons name="auto-awesome" size={24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Studio"
        component={StudioScreen}
        options={{
          tabBarIcon: ({ color, size }) => <MaterialIcons name="equalizer" size={24} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0a0a12" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="Home" component={HomeTabs} />
        <Stack.Screen name="Process" component={ProcessScreen} />
        <Stack.Screen name="Effects" component={EffectsScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
        <Stack.Screen name="Studio" component={StudioScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
