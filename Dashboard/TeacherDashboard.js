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
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

// small safe logger to avoid crashes from bad console calls
const safeWarn = (...args) => {
  try {
    if (console && typeof console.warn === "function") console.warn(...args);
  } catch (e) {}
};

export default function TeacherDashboard({ user, onSignOut }) {
  // UI / navigation — default to Manage as main screen
  const [view, setView] = useState("manage"); // home | class | manage | open
  const [loading, setLoading] = useState(true);

  // class editor fields
  const [subject, setSubject] = useState("");
  const [department, setDepartment] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [block, setBlock] = useState("");

  // classes and open class
  const [classesList, setClassesList] = useState([]); // array of { id, meta, students, attendance }
  const [openClassId, setOpenClassId] = useState(null);

  // open-class student input
  const [newStudentEmail, setNewStudentEmail] = useState("");

  useEffect(() => {
    loadAllClasses();
  }, []);

  function normalizeEntry(entry) {
    if (!entry) return [];
    if (Array.isArray(entry)) return entry;
    if (typeof entry === "object") return [entry];
    return [];
  }

  async function loadAllClasses() {
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      setClassesList(arr);
    } catch (e) {
      safeWarn("loadAllClasses error", e);
      Alert.alert("Error", "Unable to load classes");
    } finally {
      setLoading(false);
    }
  }

  async function persistClasses(newList = classesList) { // <- safe default -> use current state when omitted
    try {
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      if (!newList || newList.length === 0) {
        delete all[user.email];
      } else {
        all[user.email] = newList;
      }
      await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(all));
      setClassesList(newList);
    } catch (e) {
      safeWarn("persistClasses error", e);
      Alert.alert("Error", "Unable to save classes");
    }
  }

  // Create a new class and save to Manage
  async function handleSaveClass() {
    const meta = {
      subject: subject.trim(),
      department: department.trim(),
      yearLevel: yearLevel.trim(),
      block: block.trim(),
    };
    if (!meta.subject) {
      Alert.alert("Validation", "Subject is required");
      return;
    }
    const newClass = {
      id: Date.now().toString(),
      meta,
      students: [],
      attendance: {},
    };
    const updated = [...classesList, newClass];
    await persistClasses(updated);
    // reset inputs
    setSubject("");
    setDepartment("");
    setYearLevel("");
    setBlock("");
    setView("manage");
    Alert.alert("Saved", "Class saved");
  }

  // cross-platform confirmation: window.confirm on web, skip modal on native (no Alert)
  async function confirmDialog(title, message) {
    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(`${title}\n\n${message}`);
    }
    // no modal on native by request — proceed and log
    safeWarn("confirmDialog: skipping native confirmation:", title, message);
    return true;
  }

  // remove a class the current account manages (no Alert popups)
  async function removeClass(classId) {
    try {
      safeWarn("removeClass: start", classId);
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      const cls = arr.find((c) => c.id === classId);
      if (!cls) {
        safeWarn("removeClass: not found", classId);
        await loadAllClasses();
        return;
      }

      const ok = await confirmDialog(
        "Remove class",
        `Remove "${cls.meta?.subject || "(no subject)"}"? This will delete the class and unenroll its students.`
      );
      if (!ok) {
        safeWarn("removeClass: user cancelled", classId);
        return;
      }

      // remove from instructor list and persist via helper
      const remaining = arr.filter((c) => c.id !== classId);
      await persistClasses(remaining);
      safeWarn("removeClass: persisted remaining length", remaining.length);

      // unenroll students (support students as strings or { email })
      if (Array.isArray(cls.students) && cls.students.length) {
        const rawUsers = await AsyncStorage.getItem(USERS_KEY);
        const users = rawUsers ? JSON.parse(rawUsers) : {};
        let changed = false;
        for (const s of cls.students) {
          const em = typeof s === "string" ? s : s?.email;
          if (!em) continue;
          const u = users[em];
          if (u && Array.isArray(u.classes)) {
            const filtered = u.classes.filter((cc) => cc.id !== classId);
            if (filtered.length !== u.classes.length) {
              users[em] = { ...u, classes: filtered };
              changed = true;
            }
          }
        }
        if (changed) {
          await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
          safeWarn("removeClass: unenrolled students and updated users storage");
        } else {
          safeWarn("removeClass: no student user records changed");
        }
      } else {
        safeWarn("removeClass: no students to unenroll");
      }

      // refresh UI
      await loadAllClasses();
      if (openClassId === classId) setOpenClassId(null);
      setView("manage");
      safeWarn("removeClass: finished", classId);
    } catch (e) {
      safeWarn("removeClass storage read error", e);
    }
  }

  // remove student from open class and from user's classes (no Alert popups)
  async function removeStudentFromOpenClass(email) {
    const cls = currentClass && typeof currentClass === "function" ? currentClass() : null;
    if (!cls) {
      safeWarn("removeStudentFromOpenClass: no open class");
      return;
    }

    const ok = await confirmDialog("Remove student", `Remove ${email} from this class?`);
    if (!ok) {
      safeWarn("removeStudentFromOpenClass: cancelled", email);
      return;
    }

    try {
      // read latest storage
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      const target = arr.find((c) => c.id === cls.id);
      if (!target) {
        safeWarn("removeStudentFromOpenClass: class not found");
        await loadAllClasses();
        return;
      }

      // remove student and persist
      const updatedStudents = (target.students || []).filter((s) => {
        const em = typeof s === "string" ? s : s?.email;
        return em !== email;
      });
      const updatedClass = { ...target, students: updatedStudents };
      const updatedArr = arr.map((c) => (c.id === updatedClass.id ? updatedClass : c));
      await persistClasses(updatedArr);

      // update user's record (only if needed)
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      const u = users[email];
      if (u && Array.isArray(u.classes)) {
        const filtered = u.classes.filter((c) => c.id !== cls.id);
        if (filtered.length !== u.classes.length) {
          users[email] = { ...u, classes: filtered };
          await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
        }
      }

      // clear input and refresh
      setNewStudentEmail("");
      await loadAllClasses();
      // keep Class view if class still exists
      const exists = updatedArr.find((c) => c.id === cls.id);
      if (!exists) {
        setOpenClassId(null);
        setView("manage");
      } else {
        setView("class");
      }

      safeWarn("removeStudentFromOpenClass: finished", email, cls.id);
    } catch (e) {
      safeWarn("removeStudentFromOpenClass error", e);
    }
  }

  function openClass(classId) {
    setOpenClassId(classId);
    setView("class"); // show class view (renderClass handles both create + open)
  }

  function closeClass() {
    setOpenClassId(null);
    setView("manage");
  }

  // implement adding student properly (persist into class.students as string)
  async function handleAddStudent() {
    const email = (newStudentEmail || "").trim().toLowerCase();
    if (!email) {
      Alert.alert("Validation", "Email is required");
      return;
    }

    // validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert("Validation", "Enter a valid student email");
      return;
    }
    
    try {
      // read latest classes
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      const idx = arr.findIndex((c) => c.id === openClassId);
      if (idx === -1) {
        Alert.alert("Error", "Open class not found");
        await loadAllClasses();
        return;
      }

      // ensure student is registered
      const rawUsersCheck = await AsyncStorage.getItem(USERS_KEY);
      const usersCheck = rawUsersCheck ? JSON.parse(rawUsersCheck) : {};
      const registered = usersCheck[email];
      if (!registered || (registered.role && registered.role.toLowerCase() !== "student")) {
        Alert.alert("Not registered", "Student email not found or not registered as a student");
        return;
      }

      const cls = arr[idx] || { id: openClassId, meta: {}, students: [], attendance: {} };
      // avoid duplicates
      const exists = (cls.students || []).some((s) => (typeof s === "string" ? s === email : s?.email === email));
      if (exists) {
        Alert.alert("Duplicate", "Student already in class");
        setNewStudentEmail("");
        return;
      }

      // append as string (matches renderClass)
      const updatedStudents = [...(cls.students || []), email];
      const updatedClass = { ...cls, students: updatedStudents };
      const updatedArr = arr.map((c) => (c.id === updatedClass.id ? updatedClass : c));
      await persistClasses(updatedArr);

      // update registered student's user record with this class reference (only if needed)
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      const u = users[email];
      if (u && Array.isArray(u.classes)) {
        const classMetaWithId = { id: updatedClass.id, instructor: user.email, ...updatedClass.meta };
        const hasClass = u.classes.find((c) => c.id === updatedClass.id);
        if (!hasClass) {
          users[email] = { ...u, classes: [...u.classes, classMetaWithId] };
          await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
          safeWarn("handleAddStudent: updated user record for", email);
        }
      }

      setNewStudentEmail("");
      await loadAllClasses();
      Alert.alert("Success", "Student added");
    } catch (e) {
      safeWarn("handleAddStudent error", e);
      Alert.alert("Error", "Unable to add student");
    }
  }

  function renderHome() {
    const name = (user && (user.name || user.email)) || "Teacher";
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Hello, {name}</Text>
        <Text style={styles.subtitle}>Your teaching dashboard</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setView("manage")}
        >
          <Text style={styles.buttonText}>Manage Classes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => onSignOut()}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderManage() {
    const name = (user && (user.name || user.email)) || "Teacher";
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>Hello, {name}</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={() => onSignOut()}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.header, { marginTop: 8 }]}>Manage Classes</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setView("class")}
        >
          <Text style={styles.addButtonText}>+ Add Class</Text>
        </TouchableOpacity>
        <ScrollView>
          {classesList.length === 0 && (
            <Text style={styles.emptyText}>No classes found</Text>
          )}
          {classesList.map((cls) => (
            <View key={cls.id} style={styles.classItem}>
              <TouchableOpacity
                onPress={() => openClass(cls.id)}
                style={{ flex: 1 }}
              >
                <Text style={styles.classText}>{cls.meta.subject}</Text>
                <Text style={styles.classText}>
                  {cls.meta.department} - {cls.meta.yearLevel} {cls.meta.block}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: "row", marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: "#007bff", marginRight: 8 }]}
                  onPress={() => openClass(cls.id)}
                >
                  <Text style={styles.addButtonText}>Open</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: "#dc3545" }]}
                  onPress={() => removeClass(cls.id)}
                >
                  <Text style={styles.addButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  function renderClass() {
    const cls = classesList.find((c) => c.id === openClassId);

    // If there is no openClassId -> show the "Create Class" form
    if (!cls) {
      return (
        <View style={styles.container}>
          <Text style={styles.header}>Create Class</Text>
          <TextInput
            style={styles.input}
            placeholder="Subject"
            value={subject}
            onChangeText={setSubject}
          />
          <TextInput
            style={styles.input}
            placeholder="Department"
            value={department}
            onChangeText={setDepartment}
          />
          <TextInput
            style={styles.input}
            placeholder="Year Level"
            value={yearLevel}
            onChangeText={setYearLevel}
          />
          <TextInput
            style={styles.input}
            placeholder="Block"
            value={block}
            onChangeText={setBlock}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleSaveClass}>
            <Text style={styles.addButtonText}>Save Class</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => setView("manage")}>
            <Text style={styles.closeButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Otherwise show class details
    return (
      <View style={styles.container}>
        <Text style={styles.header}>{cls.meta.subject}</Text>
        <Text style={styles.metaText}>
          {cls.meta.department} - {cls.meta.yearLevel} {cls.meta.block}
        </Text>
        <TouchableOpacity style={styles.closeButton} onPress={closeClass}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
        <View style={styles.studentsContainer}>
          <Text style={styles.subheader}>Students</Text>
          <FlatList
            data={cls.students || []}
            renderItem={({ item }) => <Text style={styles.studentText}>{item}</Text>}
            keyExtractor={(item, index) => index.toString()}
            ListEmptyComponent={<Text style={styles.emptyText}>No students enrolled</Text>}
          />
          <TextInput
            style={styles.input}
            placeholder="Enter student email"
            value={newStudentEmail}
            onChangeText={setNewStudentEmail}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddStudent}>
            <Text style={styles.addButtonText}>+ Add Student</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  }

  switch (view) {
    case "home":
      return renderHome();
    case "manage":
      return renderManage();
    case "class":
      return renderClass();
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerGreeting: {
    fontSize: 18,
    fontWeight: "600",
  },
  logoutButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#dc3545",
    borderRadius: 6,
  },
  logoutText: {
    color: "#fff",
    fontSize: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
  button: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#007bff",
    borderRadius: 5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff",
  },
  header: {
    fontSize: 22,
    fontWeight: "bold",
  },
  subheader: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 10,
  },
  metaText: {
    fontSize: 14,
    color: "#666",
  },
  classItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  classText: {
    fontSize: 16,
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 5,
    padding: 10,
    marginTop: 10,
  },
  addButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#28a745",
    borderRadius: 5,
    alignItems: "center",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 16,
  },
  closeButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#dc3545",
    borderRadius: 5,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#fff",
    fontSize: 16,
  },
  studentsContainer: {
    marginTop: 20,
  },
  studentText: {
    fontSize: 16,
  },
});