import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function StudentDashboard({ onBack }) {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>👋 Welcome, Juan Dela Cruz!</Text>

      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>📋 My Attendance Summary</Text>
        <Text>Present: 20 days</Text>
        <Text>Absent: 2 days</Text>
        <Text>Late: 1 day</Text>
      </View>

      <TouchableOpacity style={styles.btn}>
        <Text style={styles.btnText}>View Attendance History</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn}>
        <Text style={styles.btnText}>Message Teacher 💬</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>© 2025 ClassCheck</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8faff", padding: 20 },
  header: { fontSize: 22, fontWeight: "700", marginBottom: 10, color: "#1a1a2e" },
  backBtn: { marginBottom: 10 },
  backText: { color: "#4a6cf7", fontSize: 16 },
  summaryBox: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  btn: {
    backgroundColor: "#4a6cf7",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginVertical: 10,
  },
  btnText: { color: "#fff", fontWeight: "600" },
  footer: { textAlign: "center", color: "#999", marginTop: 30 },
});
