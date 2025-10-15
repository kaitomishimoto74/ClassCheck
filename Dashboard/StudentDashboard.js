import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function StudentDashboard({ user, onSignOut }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Student Dashboard</Text>
      <Text style={styles.sub}>Hello, {user?.name ?? user?.email}</Text>
      <TouchableOpacity style={styles.button} onPress={onSignOut}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  title: { fontSize: 26, fontWeight: "700" },
  sub: { marginVertical: 12 },
  button: {
    marginTop: 12,
    backgroundColor: "#d9534f",
    padding: 12,
    borderRadius: 8,
  },
  buttonText: { color: "#fff" },
});
