import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Picker } from "@react-native-picker/picker";


export default function TeacherDashboard({ onBack }) {
  const [department, setDepartment] = useState("BSIT");
  const [yearLevel, setYearLevel] = useState("3rd Year");
  const [block, setBlock] = useState("Block 1");

  const [summary, setSummary] = useState({
    total: 30,
    present: 27,
    absent: 3,
  });

  const handleLoadClass = () => {
    alert(`Loaded: ${department}, ${yearLevel}, ${block}`);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>👋 Welcome, Mr. Santos!</Text>

      {/* Back Button */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {/* Class Selector */}
      <View style={styles.selector}>
        <Text style={styles.sectionTitle}>🏫 Select Class</Text>

        <Text style={styles.label}>Department</Text>
        <Picker
          selectedValue={department}
          style={styles.picker}
          onValueChange={(itemValue) => setDepartment(itemValue)}
        >
          <Picker.Item label="BSIT" value="BSIT" />
          <Picker.Item label="BSOA" value="BSOA" />
          <Picker.Item label="BEED" value="BEED" />
          <Picker.Item label="BSCRIM" value="BSCRIM" />
        </Picker>

        <Text style={styles.label}>Year Level</Text>
        <Picker
          selectedValue={yearLevel}
          style={styles.picker}
          onValueChange={(itemValue) => setYearLevel(itemValue)}
        >
          <Picker.Item label="1st Year" value="1st Year" />
          <Picker.Item label="2nd Year" value="2nd Year" />
          <Picker.Item label="3rd Year" value="3rd Year" />
          <Picker.Item label="4th Year" value="4th Year" />
        </Picker>

        <Text style={styles.label}>Block</Text>
        <Picker
          selectedValue={block}
          style={styles.picker}
          onValueChange={(itemValue) => setBlock(itemValue)}
        >
          <Picker.Item label="Block 1" value="Block 1" />
          <Picker.Item label="Block 2" value="Block 2" />
          <Picker.Item label="Block 3" value="Block 3" />
          <Picker.Item label="Block 4" value="Block 4" />
        </Picker>

        <TouchableOpacity style={styles.loadBtn} onPress={handleLoadClass}>
          <Text style={styles.loadBtnText}>✔️ Load Class</Text>
        </TouchableOpacity>
      </View>

      {/* Summary Section */}
      <View style={styles.summary}>
        <Text style={styles.sectionTitle}>📊 Attendance Summary</Text>
        <View style={styles.cardsRow}>
          <View style={styles.card}>
            <Text style={styles.cardNumber}>{summary.total}</Text>
            <Text style={styles.cardLabel}>Total Students</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardNumber}>{summary.present}</Text>
            <Text style={styles.cardLabel}>Present</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardNumber}>{summary.absent}</Text>
            <Text style={styles.cardLabel}>Absent</Text>
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actions}>
        <Text style={styles.sectionTitle}>⚡ Quick Actions</Text>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>Mark Attendance</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>View Attendance History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>Export Data</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn}>
          <Text style={styles.actionText}>Chat 💬</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>© 2025 ClassCheck</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8faff", padding: 16 },
  header: { fontSize: 22, fontWeight: "700", marginBottom: 10, color: "#1a1a2e" },
  backBtn: { marginBottom: 10 },
  backText: { color: "#4a6cf7", fontSize: 16 },
  selector: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  label: { marginTop: 10, fontSize: 14, color: "#333" },
  picker: { backgroundColor: "#f0f2ff", borderRadius: 10 },
  loadBtn: {
    backgroundColor: "#4a6cf7",
    padding: 10,
    borderRadius: 8,
    marginTop: 15,
    alignItems: "center",
  },
  loadBtnText: { color: "#fff", fontWeight: "600" },
  summary: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 20 },
  cardsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  card: { backgroundColor: "#f0f2ff", borderRadius: 10, padding: 10, flex: 1, alignItems: "center", marginHorizontal: 5 },
  cardNumber: { fontSize: 20, fontWeight: "700", color: "#2f3e46" },
  cardLabel: { fontSize: 12, color: "#555" },
  actions: { backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  actionBtn: {
    backgroundColor: "#4a6cf7",
    borderRadius: 8,
    paddingVertical: 12,
    marginVertical: 6,
    alignItems: "center",
  },
  actionText: { color: "#fff", fontWeight: "600" },
  footer: { textAlign: "center", color: "#999", marginVertical: 20 },
});
