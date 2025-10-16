import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

export default function StudentDashboard({ user, onSignOut }) {
  const email = (user && user.email) || "";
  const [loading, setLoading] = useState(true);
  const [usersMap, setUsersMap] = useState({});
  const [allClassesMap, setAllClassesMap] = useState({}); // ownerEmail -> [classes]
  const [view, setView] = useState("list"); // list | class
  const [selectedClass, setSelectedClass] = useState(null); // { cls, ownerEmail }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      setUsersMap(users);

      const rawClasses = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = rawClasses ? JSON.parse(rawClasses) : {};
      setAllClassesMap(classes);
    } catch (e) {
      console.warn("load student dashboard data", e);
    } finally {
      setLoading(false);
    }
  }

  // gather classes where this student is enrolled
  const classesForStudent = useMemo(() => {
    const res = [];
    Object.entries(allClassesMap || {}).forEach(([ownerEmail, arr]) => {
      const list = Array.isArray(arr) ? arr : [];
      list.forEach((c) => {
        const students = Array.isArray(c.students) ? c.students : [];
        const found = students.some((s) => {
          const em = typeof s === "string" ? s : s?.email;
          return em === email;
        });
        if (found) {
          res.push({ cls: c, ownerEmail });
        }
      });
    });
    // sort by subject then by id
    res.sort((a, b) => {
      const A = (a.cls.meta?.subject || "").toLowerCase();
      const B = (b.cls.meta?.subject || "").toLowerCase();
      if (A !== B) return A < B ? -1 : 1;
      return (a.cls.id || "").localeCompare(b.cls.id || "");
    });
    return res;
  }, [allClassesMap, email]);

  function getTeacherDisplay(ownerEmail, cls) {
    // prefer instructor in student's classes meta if present
    const instructor = (cls.meta && cls.meta.instructor) || ownerEmail;
    const t = usersMap[instructor] || usersMap[ownerEmail] || {};
    if (t.lastName && t.firstName) return `${t.lastName}, ${t.firstName}`;
    if (t.firstName || t.lastName) return `${t.firstName || ""} ${t.lastName || ""}`.trim();
    return t.name || instructor;
  }

  function gatherDatesForClass(c) {
    const att = c.attendance || {};
    const hist = Array.isArray(c.attendanceHistory) ? c.attendanceHistory.map((h) => h.date) : [];
    const dates = new Set(Object.keys(att || {}));
    hist.forEach((d) => dates.add(d));
    // return sorted descending (most recent first)
    return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
  }

  function computeStats(c) {
    const dates = gatherDatesForClass(c);
    let present = 0;
    dates.forEach((d) => {
      if (c.attendance && c.attendance[d]) {
        if (c.attendance[d][email]) present += 1;
        return;
      }
      // fallback to attendanceHistory entry
      if (Array.isArray(c.attendanceHistory)) {
        const h = c.attendanceHistory.find((hh) => hh.date === d);
        if (h && Array.isArray(h.present) && h.present.includes(email)) present += 1;
      }
    });
    const total = dates.length;
    const absent = Math.max(0, total - present);
    return { total, present, absent, dates };
  }

  function openClassDetail(cls, ownerEmail) {
    setSelectedClass({ cls, ownerEmail });
    setView("class");
  }

  function closeClassDetail() {
    setSelectedClass(null);
    setView("list");
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (view === "class" && selectedClass) {
    const c = selectedClass.cls;
    const teacher = getTeacherDisplay(selectedClass.ownerEmail, c);
    const stats = computeStats(c);
    const dates = stats.dates;
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>{c.meta?.subject || "Class"}</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={closeClassDetail}>
            <Text style={styles.logoutText}>Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.metaText}>
            {c.meta?.department} - {c.meta?.yearLevel} {c.meta?.block}
          </Text>
          <Text style={{ marginTop: 8 }}>Teacher: {teacher}</Text>
          <Text style={{ marginTop: 8, fontWeight: "600" }}>
            Present: {stats.present} · Absent: {stats.absent} · Total classes: {stats.total}
          </Text>
        </View>

        <Text style={[styles.subheader, { marginTop: 12 }]}>Attendance Records</Text>
        <ScrollView style={{ marginTop: 8 }}>
          {dates.length === 0 && <Text style={styles.emptyText}>No attendance recorded yet</Text>}
          {dates.map((d) => {
            // determine this student's status on date
            let presentOnDate = false;
            if (c.attendance && c.attendance[d]) {
              presentOnDate = !!c.attendance[d][email];
            } else if (Array.isArray(c.attendanceHistory)) {
              const h = c.attendanceHistory.find((hh) => hh.date === d);
              presentOnDate = !!(h && Array.isArray(h.present) && h.present.includes(email));
            }
            return (
              <View key={d} style={styles.recordRow}>
                <Text style={{ fontWeight: "600" }}>{d}</Text>
                <Text style={{ color: presentOnDate ? "#28a745" : "#6c757d" }}>
                  {presentOnDate ? "Present" : "Absent"}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // list view
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerGreeting}>
          {user && (user.lastName ? `${user.lastName}, ${user.firstName || ""}`.trim() : user.name || user.email)}
        </Text>
        <TouchableOpacity style={styles.logoutButton} onPress={() => onSignOut && onSignOut()}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.header, { marginTop: 12 }]}>My Classes</Text>
      <ScrollView style={{ marginTop: 8 }}>
        {classesForStudent.length === 0 && <Text style={styles.emptyText}>You are not enrolled in any classes</Text>}
        {classesForStudent.map(({ cls, ownerEmail }) => {
          const stats = computeStats(cls);
          const teacher = getTeacherDisplay(ownerEmail, cls);
          return (
            <View key={cls.id} style={styles.classItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.classText}>{cls.meta?.subject || "(no subject)"}</Text>
                <Text style={styles.metaText}>{teacher}</Text>
                <Text style={{ marginTop: 6 }}>
                  Present: {stats.present} · Absent: {stats.absent} · Total: {stats.total}
                </Text>
              </View>
              <View style={{ justifyContent: "center" }}>
                <TouchableOpacity style={styles.viewButton} onPress={() => openClassDetail(cls, ownerEmail)}>
                  <Text style={styles.viewButtonText}>View</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1, padding: 18, backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerGreeting: { fontSize: 18, fontWeight: "600" },
  logoutButton: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#dc3545", borderRadius: 6 },
  logoutText: { color: "#fff" },
  header: { fontSize: 20, fontWeight: "700" },
  classItem: { flexDirection: "row", padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee", alignItems: "center" },
  classText: { fontSize: 16, fontWeight: "600" },
  metaText: { color: "#666" },
  emptyText: { textAlign: "center", color: "#999", marginTop: 20 },
  viewButton: { backgroundColor: "#007bff", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  viewButtonText: { color: "#fff", fontWeight: "700" },
  card: { padding: 12, borderRadius: 8, backgroundColor: "#f8f9fa", marginTop: 12 },
  subheader: { fontSize: 16, fontWeight: "600" },
  recordRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
});
