import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  FlatList,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

export default function TeacherDashboard({ user, onSignOut }) {
  // editable class fields
  const [subject, setSubject] = useState("");
  const [department, setDepartment] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [block, setBlock] = useState("");

  // class / students state
  const [students, setStudents] = useState([]); // array of { email, name? }
  const [loading, setLoading] = useState(true);

  // attendance state for selected date (default today)
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [attendance, setAttendance] = useState({}); // { email: true|false }
  const [view, setView] = useState("class"); // 'class' | 'manage' | 'attendance'

  // add-student state (inside attendance)
  const [newStudentEmail, setNewStudentEmail] = useState("");

  // load saved classes for this instructor
  useEffect(() => {
    loadClassData();
  }, []);

  async function loadClassData() {
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = raw ? JSON.parse(raw) : {};
      const cls = classes[user.email] || { students: [], attendance: {}, meta: {} };
      setStudents(cls.students || []);
      const todays = (cls.attendance && cls.attendance[todayKey]) || {};
      setAttendance(todays);

      // load editable meta if present
      const meta = cls.meta || {};
      setSubject(meta.subject || "");
      setDepartment(meta.department || "");
      setYearLevel(meta.yearLevel || "");
      setBlock(meta.block || "");
    } catch (e) {
      console.warn("loadClassData error", e);
      Alert.alert("Error", "Unable to load class data");
    } finally {
      setLoading(false);
    }
  }

  async function saveClass(studentsList, attendanceObj) {
    try {
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = raw ? JSON.parse(raw) : {};
      classes[user.email] = {
        students: studentsList,
        attendance: (classes[user.email] && classes[user.email].attendance) || {},
        meta: { subject, department, yearLevel, block },
      };
      if (attendanceObj) classes[user.email].attendance[todayKey] = attendanceObj;
      await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(classes));
    } catch (e) {
      console.warn("saveClass error", e);
      Alert.alert("Error", "Unable to save class data");
    }
  }

  async function handleSaveClass() {
    await saveClass(students, attendance);
    Alert.alert("Saved", "Class info saved");
  }

  // remove entire class (with confirmation). also remove enrollment from students.
  async function removeClass() {
    Alert.alert(
      "Remove class",
      "This will remove the saved class and unenroll students from this class. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const rawClasses = await AsyncStorage.getItem(CLASSES_KEY);
              const classes = rawClasses ? JSON.parse(rawClasses) : {};
              const cls = classes[user.email];
              // remove class entry
              delete classes[user.email];
              await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(classes));

              // remove class reference from each student's user record
              if (cls && cls.students && cls.students.length) {
                const rawUsers = await AsyncStorage.getItem(USERS_KEY);
                const users = rawUsers ? JSON.parse(rawUsers) : {};
                const meta = cls.meta || { subject, department, yearLevel, block };
                for (const s of cls.students) {
                  const em = s.email;
                  const u = users[em];
                  if (u) {
                    const arr = Array.isArray(u.classes) ? u.classes : [];
                    users[em] = { ...u, classes: arr.filter((c) => !(c.instructor === user.email && c.subject === meta.subject && c.department === meta.department && c.yearLevel === meta.yearLevel && c.block === meta.block)) };
                  }
                }
                await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
              }

              // reset local state
              setStudents([]);
              setAttendance({});
              setSubject("");
              setDepartment("");
              setYearLevel("");
              setBlock("");
              Alert.alert("Removed", "Class removed");
            } catch (e) {
              console.warn("removeClass error", e);
              Alert.alert("Error", "Unable to remove class");
            }
          },
        },
      ]
    );
  }

  function confirmRemoveStudent(email) {
    Alert.alert("Remove student", `Remove ${email} from this class?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeStudent(email) },
    ]);
  }

  async function removeStudent(email) {
    const updated = students.filter((s) => s.email !== email);
    const newAttendance = { ...attendance };
    delete newAttendance[email];
    setStudents(updated);
    setAttendance(newAttendance);
    await saveClass(updated, newAttendance);

    // remove class reference from the user's record
    try {
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      const u = users[email];
      if (u && Array.isArray(u.classes)) {
        users[email] = { ...u, classes: u.classes.filter((c) => !(c.instructor === user.email && c.subject === subject && c.department === department && c.yearLevel === yearLevel && c.block === block)) };
        await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
      }
    } catch (e) {
      console.warn("removeStudent user update error", e);
    }
  }

  function toggleAttendance(email) {
    const newA = { ...attendance, [email]: !attendance[email] };
    setAttendance(newA);
  }

  async function handleSaveAttendance() {
    await saveClass(students, attendance);
    Alert.alert("Saved", "Attendance saved for today");
  }

  // add student to class and enroll in user's record
  async function addStudentToClass() {
    const email = (newStudentEmail || "").trim().toLowerCase();
    if (!email) {
      Alert.alert("Validation", "Enter student email");
      return;
    }
    if (students.some((s) => s.email === email)) {
      Alert.alert("Duplicate", "Student already in class");
      setNewStudentEmail("");
      return;
    }

    try {
      // update class students list
      const updated = [...students, { email, name: null }];
      setStudents(updated);
      await saveClass(updated, attendance);

      // update user record so student sees the class
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      const u = users[email] || { name: null, password: null, role: "Student", classes: [] };
      const classMeta = { instructor: user.email, subject, department, yearLevel, block };
      const existing = Array.isArray(u.classes) ? u.classes.find((c) => c.instructor === user.email && c.subject === subject && c.department === department && c.yearLevel === yearLevel && c.block === block) : null;
      if (!existing) {
        const arr = Array.isArray(u.classes) ? [...u.classes, classMeta] : [classMeta];
        users[email] = { ...u, classes: arr, role: u.role || "Student" };
        await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
      }

      setNewStudentEmail("");
      Alert.alert("Added", `${email} added to class`);
    } catch (e) {
      console.warn("addStudentToClass error", e);
      Alert.alert("Error", "Unable to add student");
    }
  }

  // render student row (remove still allowed)
  function renderStudent({ item }) {
    return (
      <View style={styles.studentRow}>
        <Text style={styles.studentText}>{item.name ? `${item.name} — ` : ""}{item.email}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {view === "attendance" ? (
            <TouchableOpacity
              style={[styles.attBtn, attendance[item.email] ? styles.present : styles.absent]}
              onPress={() => toggleAttendance(item.email)}
            >
              <Text style={styles.attText}>{attendance[item.email] ? "Present" : "Absent"}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.removeBtn} onPress={() => confirmRemoveStudent(item.email)}>
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const totalCount = students.length;

  // Saved class card for Manage view
  function SavedClassCard() {
    const metaLabel = `${subject || "(no subject)"} • ${department || "(no department)"} • ${yearLevel || "(no year)"} • ${block || "(no block)"}`;
    return (
      <View style={styles.savedCard}>
        <Text style={styles.savedTitle}>{metaLabel}</Text>
        <Text style={styles.savedSub}>{totalCount} students</Text>
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <TouchableOpacity style={[styles.loadBtn, { flex: 1, marginRight: 8 }]} onPress={() => { setView("class"); }}>
            <Text style={styles.loadBtnText}>Open Class</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.loadBtn, { flex: 1 }]} onPress={() => { /* ensure saved then open attendance */ handleSaveClass().then(() => setView("attendance")); }}>
            <Text style={styles.loadBtnText}>Mark Attendance</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>👋 Welcome, {user?.name ?? user?.email}!</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.removeClassBtn} onPress={removeClass}>
            <Text style={styles.removeClassText}>Remove Class</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutTop} onPress={onSignOut}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, view === "class" && styles.modeActive]}
          onPress={() => setView("class")}
        >
          <Text style={[styles.modeText, view === "class" && styles.modeTextActive]}>Class</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeBtn, view === "manage" && styles.modeActive]}
          onPress={() => setView("manage")}
        >
          <Text style={[styles.modeText, view === "manage" && styles.modeTextActive]}>Manage Classes</Text>
        </TouchableOpacity>
      </View>

      {view === "manage" ? (
        <View style={styles.selector}>
          <Text style={styles.sectionTitle}>Saved Class</Text>
          <SavedClassCard />
          <Text style={styles.note}>Saved classes are listed here. Use "Mark Attendance" to add students and take attendance.</Text>
        </View>
      ) : view === "class" ? (
        <View style={styles.selector}>
          <Text style={styles.sectionTitle}>🏫 Class Info</Text>

          <Text style={styles.label}>Subject Name</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="e.g., IT Elective 1"
            style={styles.textInput}
          />

          <Text style={styles.label}>Department</Text>
          <TextInput
            value={department}
            onChangeText={setDepartment}
            placeholder="e.g., BSIT"
            style={styles.textInput}
          />

          <Text style={styles.label}>Year / Course</Text>
          <TextInput
            value={yearLevel}
            onChangeText={setYearLevel}
            placeholder="e.g., 3rd Year"
            style={styles.textInput}
          />

          <Text style={styles.label}>Block / Section</Text>
          <TextInput
            value={block}
            onChangeText={setBlock}
            placeholder="Block 2"
            style={styles.textInput}
          />

          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <TouchableOpacity style={[styles.loadBtn, { flex: 1 }]} onPress={handleSaveClass}>
              <Text style={styles.loadBtnText}>Save Class</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionTitle}>Students</Text>
            <Text style={styles.note}>
              Students are managed in Mark Attendance. Use Manage Classes → Mark Attendance to add students and take attendance.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.selector}>
          <Text style={styles.sectionTitle}>📅 Mark Attendance — {todayKey}</Text>
          <Text style={styles.note}>Add students and mark attendance here.</Text>

          <View style={{ marginTop: 12 }}>
            <View style={styles.addRow}>
              <TextInput
                placeholder="student@example.com"
                value={newStudentEmail}
                onChangeText={setNewStudentEmail}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TouchableOpacity style={styles.addBtn} onPress={addStudentToClass}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={students}
              keyExtractor={(i) => i.email}
              renderItem={renderStudent}
              ListEmptyComponent={<Text style={styles.note}>No students yet — add students above.</Text>}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAttendance}>
              <Text style={styles.saveBtnText}>Save Attendance</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.footer}>© 2025 ClassCheck</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8faff", padding: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  header: { fontSize: 20, fontWeight: "700", color: "#1a1a2e" },
  headerRight: { flexDirection: "row", alignItems: "center" },
  removeClassBtn: { marginRight: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#f44336" },
  removeClassText: { color: "#f44336", fontWeight: "600" },
  logoutTop: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#d9534f" },
  logoutText: { color: "#fff", fontWeight: "600" },

  modeRow: { flexDirection: "row", marginBottom: 12 },
  modeBtn: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#ccc", marginRight: 8 },
  modeActive: { backgroundColor: "#4a6cf7", borderColor: "#4a6cf7" },
  modeText: { color: "#333" },
  modeTextActive: { color: "#fff" },
  selector: { backgroundColor: "#fff", padding: 16, borderRadius: 12, marginBottom: 20, elevation: 2 },
  sectionTitle: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  label: { marginTop: 10, fontSize: 14, color: "#333" },
  textInput: { height: 44, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, marginTop: 6, marginBottom: 8 },
  loadBtn: { backgroundColor: "#4a6cf7", padding: 10, borderRadius: 8, marginTop: 15, alignItems: "center" },
  loadBtnText: { color: "#fff", fontWeight: "600" },
  savedCard: { backgroundColor: "#f7fbff", padding: 14, borderRadius: 12, marginBottom: 12 },
  savedTitle: { fontSize: 16, fontWeight: "700" },
  savedSub: { color: "#666", marginTop: 6 },
  note: { marginTop: 10, color: "#666" },
  studentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderColor: "#f0f0f0" },
  studentText: { color: "#222" },
  removeBtn: { marginLeft: 12, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#f44336" },
  removeText: { color: "#f44336" },
  attBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 8 },
  present: { backgroundColor: "#28a745" },
  absent: { backgroundColor: "#ccc" },
  attText: { color: "#fff", fontWeight: "600" },
  saveBtn: { backgroundColor: "#28a745", padding: 12, borderRadius: 8, marginTop: 16, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700" },

  // attendance add row
  addRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  input: { flex: 1, height: 44, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, marginRight: 8 },
  addBtn: { backgroundColor: "#4a6cf7", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  addBtnText: { color: "#fff", fontWeight: "600" },

  footer: { textAlign: "center", color: "#999", marginVertical: 20 },
});
