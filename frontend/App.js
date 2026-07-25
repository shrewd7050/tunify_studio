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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0a0a0a",
          borderTopWidth: 0,
          height: 70,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: "#00FF88",
        tabBarInactiveTintColor: "#444",
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="mic" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Generate"
        component={GenerateScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="auto-awesome" size={24} color={color} />
          ),
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
          contentStyle: { backgroundColor: "#0a0a0a" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="Home" component={HomeTabs} />
        <Stack.Screen name="Process" component={ProcessScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
