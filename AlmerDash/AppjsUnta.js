import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import TeacherDashboard from "./screens/TeacherDashboard";
import StudentDashboard from "./screens/StudentDashboard";

export default function App() {
  const [role, setRole] = useState(null); // "teacher" or "student"

  if (role === "teacher") {
    return <TeacherDashboard onBack={() => setRole(null)} />;
  }

  if (role === "student") {
    return <StudentDashboard onBack={() => setRole(null)} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎓 ClassCheck</Text>
      <Text style={styles.subtitle}>Choose your role</Text>

      <TouchableOpacity style={styles.btn} onPress={() => setRole("teacher")}>
        <Text style={styles.btnText}>👨‍🏫 Teacher</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn} onPress={() => setRole("student")}>
        <Text style={styles.btnText}>🧑‍🎓 Student</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8faff",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1a1a2e",
  },
  subtitle: {
    marginBottom: 30,
    fontSize: 16,
    color: "#555",
  },
  btn: {
    backgroundColor: "#4a6cf7",
    padding: 15,
    borderRadius: 10,
    width: "70%",
    alignItems: "center",
    marginVertical: 10,
  },
  btnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});
