import React, { useEffect, useState, useRef } from "react";
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
import ChatScreen from "./ChatScreen";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

// silence warnings for smoother UX
const safeWarn = () => {};

// helper: detect dev server / Metro connection errors
function isDevServerError(err) {
  if (!err) return false;
  const s = typeof err === "string" ? err : (err.message || String(err));
  return /localhost|127\.0\.0\.1|:8081|development server/i.test(s);
}

export default function TeacherDashboard({ user, onSignOut }) {
  // UI / navigation — default to Manage as main screen
  const [view, setView] = useState("manage"); // home | class | manage | open
  const [attendanceClassId, setAttendanceClassId] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(null); // 'YYYY-MM-DD'
  const [attendanceState, setAttendanceState] = useState({}); // { email: true/false }
  const [loading, setLoading] = useState(true);
  // users map to display student names (email -> user object)
  const [usersMap, setUsersMap] = useState({});
  // double-press delete state
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const pendingTimerRef = useRef(null);

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

  // add state for chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState(null); // { classId, ownerEmail }

  // open/close helpers for class chat
  function openClassChat(classId, ownerEmail) {
    setChatTarget({ classId, ownerEmail });
    setChatOpen(true);
  }
  function closeClassChat() {
    setChatOpen(false);
    setChatTarget(null);
  }

  useEffect(() => {
    // install lightweight global handler to auto sign-out on Metro/dev-server errors
    let prevHandler = null;
    try {
      if (global.ErrorUtils && typeof global.ErrorUtils.getGlobalHandler === "function") {
        prevHandler = global.ErrorUtils.getGlobalHandler();
      } else if (global.ErrorUtils && global.ErrorUtils._globalHandler) {
        prevHandler = global.ErrorUtils._globalHandler;
      }

      if (global.ErrorUtils && typeof global.ErrorUtils.setGlobalHandler === "function") {
        global.ErrorUtils.setGlobalHandler((error, isFatal) => {
          if (isDevServerError(error)) {
            safeWarn("Dev server error detected, signing out:", error && (error.message || String(error)));
            onSignOut && onSignOut();
            return;
          }
          // fallback to previous handler if present so non-dev errors still show
          if (typeof prevHandler === "function") prevHandler(error, isFatal);
        });
      }
    } catch (e) {
      safeWarn("install global handler failed", e);
    }

    // existing mount behaviour
    if (!user) {
      onSignOut && onSignOut();
    } else {
      setView("manage");
      loadAllClasses();
    }

    return () => {
      // restore previous global handler
      try {
        if (global.ErrorUtils && typeof global.ErrorUtils.setGlobalHandler === "function" && prevHandler) {
          global.ErrorUtils.setGlobalHandler(prevHandler);
        }
      } catch (e) {
        // ignore
      }
    };
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
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      setUsersMap(users);
    } catch (e) {
      // if dev-server error -> sign out, otherwise silent log
      if (isDevServerError(e)) {
        safeWarn("Dev-server error during loadAllClasses, signing out", e);
        onSignOut && onSignOut();
        return;
      }
      safeWarn("loadAllClasses error", e);
    } finally {
      setLoading(false);
    }
  }

  async function persistClasses(newList = classesList) {
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
      if (isDevServerError(e)) {
        safeWarn("Dev-server error during persistClasses, signing out", e);
        onSignOut && onSignOut();
        return;
      }
      safeWarn("persistClasses error", e);
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
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      const cls = arr.find((c) => c.id === classId);
      if (!cls) {
        await loadAllClasses();
        return;
      }

      const ok = await confirmDialog(
        "Remove class",
        `Remove "${cls.meta?.subject || "(no subject)"}"? This will delete the class and unenroll its students.`
      );
      if (!ok) return;

      const remaining = arr.filter((c) => c.id !== classId);
      await persistClasses(remaining);

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
        }
      }

      await loadAllClasses();
      if (openClassId === classId) setOpenClassId(null);
      setView("manage");
    } catch (e) {
      if (isDevServerError(e)) {
        safeWarn("Dev-server error during removeClass, signing out", e);
        onSignOut && onSignOut();
        return;
      }
      safeWarn("removeClass storage read error", e);
    }
  }

  // remove student from open class and from user's classes (no Alert popups)
  async function removeStudentFromOpenClass(email) {
    const cls = classesList.find((c) => c.id === openClassId);
    if (!cls) return;

    const ok = await confirmDialog("Remove student", `Remove ${email} from this class?`);
    if (!ok) return;

    try {
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const arr = normalizeEntry(all[user.email]);
      const target = arr.find((c) => c.id === cls.id);
      if (!target) {
        await loadAllClasses();
        return;
      }

      const updatedStudents = (target.students || []).filter((s) => {
        const em = typeof s === "string" ? s : s?.email;
        return em !== email;
      });
      const updatedClass = { ...target, students: updatedStudents };
      const updatedArr = arr.map((c) => (c.id === updatedClass.id ? updatedClass : c));
      await persistClasses(updatedArr);

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

      setNewStudentEmail("");
      await loadAllClasses();
      const exists = updatedArr.find((c) => c.id === cls.id);
      if (!exists) {
        setOpenClassId(null);
        setView("manage");
      } else {
        setView("class");
      }
    } catch (e) {
      if (isDevServerError(e)) {
        safeWarn("Dev-server error during removeStudent, signing out", e);
        onSignOut && onSignOut();
        return;
      }
      safeWarn("removeStudentFromOpenClass error", e);
    }
  }

  function openClass(classId) {
    setOpenClassId(classId);
    setView("class"); // show class view (renderClass handles both create + open)
  }

  // double-press confirm delete for a class
  function handleClassDeletePress(classId) {
    // if same id pressed within timeout => execute delete
    if (pendingDeleteId === classId) {
      // clear pending timer and state
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setPendingDeleteId(null);
      removeClass(classId);
      return;
    }

    // arm pending delete for this id
    setPendingDeleteId(classId);
    // clear previous timer
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => {
      setPendingDeleteId(null);
      pendingTimerRef.current = null;
    }, 1500); // 1.5s window for second press
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
          // updated user record
        }
      }

      setNewStudentEmail("");
      await loadAllClasses();
      // success
    } catch (e) {
      if (isDevServerError(e)) {
        safeWarn("Dev-server error during addStudent, signing out", e);
        onSignOut && onSignOut();
        return;
      }
      safeWarn("handleAddStudent error", e);
    }
  }

  function formatDateKey(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  
  // Open attendance view for a class for a given date (default today)
  function openAttendance(classId, dateKey = null) {
    const key = dateKey || formatDateKey();
    setAttendanceDate(key);
    setAttendanceClassId(classId);
    // prepare attendance state from classesList
    const cls = classesList.find((c) => c.id === classId) || { students: [], attendance: {} };
    const dayRec = (cls.attendance && cls.attendance[key]) || {};
    const map = {};
    (cls.students || []).forEach((s) => {
      const em = typeof s === "string" ? s : s?.email;
      map[em] = !!dayRec[em];
    });
    setAttendanceState(map);
    setView("attendance");
  }

  function toggleAttendance(email) {
    setAttendanceState((prev) => ({ ...prev, [email]: !prev[email] }));
  }

  async function saveAttendance() {
    if (!attendanceClassId) return;
    try {
      // update classesList in-memory and persist
      const updated = classesList.map((c) => {
        if (c.id !== attendanceClassId) return c;

        // update attendance map for the date
        const att = { ...(c.attendance || {}) };
        att[attendanceDate] = { ...(att[attendanceDate] || {}) };
        Object.keys(attendanceState).forEach((em) => {
          att[attendanceDate][em] = !!attendanceState[em];
        });

        // build attendance summary for history
        const present = Object.keys(attendanceState).filter((em) => attendanceState[em]);
        const absent = Object.keys(attendanceState).filter((em) => !attendanceState[em]);

        // maintain attendanceHistory array (most-recent-first), replace entry if same date exists
        const history = Array.isArray(c.attendanceHistory) ? [...c.attendanceHistory] : [];
        const filtered = history.filter((h) => h.date !== attendanceDate);
        const newEntry = { date: attendanceDate, present, absent };
        const newHistory = [newEntry, ...filtered].slice(0, 365); // keep at most 1 year of records by default

        return { ...c, attendance: att, attendanceHistory: newHistory };
      });
      await persistClasses(updated);

      // reload to refresh usersMap & classesList
      await loadAllClasses();

      // prepare for next attendance session:
      //  - default to next day
      //  - reset attendanceState to all absent (false)
      const nextDate = formatDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const updatedClass = updated.find((c) => c.id === attendanceClassId) || {};
      const students = Array.isArray(updatedClass.students) ? updatedClass.students : [];
      const defaultMap = {};
      students.forEach((s) => {
        const em = typeof s === "string" ? s : s?.email;
        if (em) defaultMap[em] = false; // absent by default
      });
      setAttendanceClassId(attendanceClassId);
      setAttendanceDate(nextDate);
      setAttendanceState(defaultMap);
      setView("attendance");
    } catch (e) {
      safeWarn("saveAttendance error", e);
    }
  }

  // open attendance history view for a class
  function openAttendanceHistory(classId) {
    setAttendanceClassId(classId);
    setView("attendanceHistory");
  }
  
  function renderAttendanceHistory() {
    const cls = classesList.find((c) => c.id === attendanceClassId);
    if (!cls) return null;
    const history = Array.isArray(cls.attendanceHistory) ? cls.attendanceHistory : [];
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>{cls.meta.subject} — Attendance History</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={() => { setView("class"); setOpenClassId(cls.id); }}>
            <Text style={styles.logoutText}>Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ marginTop: 12 }}>
          {history.length === 0 && <Text style={styles.emptyText}>No attendance records</Text>}
          {history.map((h) => (
            <View key={h.date} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
              <Text style={{ fontWeight: "600" }}>{h.date}</Text>
              <Text style={{ color: "#666", marginTop: 4 }}>Present: {Array.isArray(h.present) ? h.present.length : 0}</Text>
              <Text style={{ color: "#666", marginTop: 2 }}>Absent: {Array.isArray(h.absent) ? h.absent.length : 0}</Text>
              <View style={{ flexDirection: "row", marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: "#17a2b8", marginRight: 8 }]}
                  onPress={() => openAttendance(cls.id, h.date)}
                >
                  <Text style={styles.addButtonText}>View</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  function renderHome() {
    const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || "Teacher";
     return (
       <View style={styles.centered}>
         <Text style={styles.title}>Hello, {firstName}</Text>
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
     const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || "Teacher";
     return (
       <View style={styles.container}>
         <View style={styles.headerRow}>
           <Text style={styles.headerGreeting}>Hello, {firstName}</Text>
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

                 {/* Attendance button removed from Manage list (use Open -> Open Attendance) */}

                 {/* Chat action moved to inside open class view */}

                 <TouchableOpacity
                   style={[styles.addButton, { backgroundColor: pendingDeleteId === cls.id ? "#ff7b7b" : "#dc3545" }]}
                   onPress={() => handleClassDeletePress(cls.id)}
                 >
                   <Text style={styles.addButtonText}>
                     {pendingDeleteId === cls.id ? "Confirm Delete" : "Delete"}
                   </Text>
                 </TouchableOpacity>
               </View>
             </View>
           ))}
         </ScrollView>
       </View>
     );
   }

  // helper: return normalized user record (guarantee firstName/lastName)
  function normalizeUserRecord(u = {}, email) {
    if (!u) return { email, firstName: null, lastName: null, gender: null, name: null };
    if (u.firstName || u.lastName) return { ...u };
    if (u.name && typeof u.name === "string") {
      const parts = u.name.trim().split(/\s+/);
      const last = parts.length > 1 ? parts.pop() : "";
      const first = parts.join(" ") || "";
      return { ...u, firstName: first || null, lastName: last || null };
    }
    return { ...u };
  }

  // display "Last, First" when available, otherwise email
  function getDisplayNameForEmail(email) {
    const uRaw = usersMap[email] || null;
    const u = normalizeUserRecord(uRaw, email);
    if (u.lastName && u.firstName) return `${u.lastName}, ${u.firstName}`;
    if (u.lastName) return u.lastName;
    if (u.firstName) return u.firstName;
    if (u.name) return u.name;
    return email;
  }

  // sort helper for students (by lastName, then firstName, then email)
  function buildSortedStudentsArray(students = []) {
    const arr = (students || []).map((s) => {
      const em = typeof s === "string" ? s : s?.email;
      const uRaw = usersMap[em] || null;
      const u = normalizeUserRecord(uRaw, em);
      return {
        email: em,
        firstName: (u.firstName || "").trim(),
        lastName: (u.lastName || "").trim(),
        display: getDisplayNameForEmail(em),
      };
    });
    arr.sort((a, b) => {
      const A = (a.lastName || "").toLowerCase();
      const B = (b.lastName || "").toLowerCase();
      if (A !== B) return A < B ? -1 : 1;
      const Af = (a.firstName || "").toLowerCase();
      const Bf = (b.firstName || "").toLowerCase();
      if (Af !== Bf) return Af < Bf ? -1 : 1;
      return (a.email || "").localeCompare(b.email || "");
    });
    return arr;
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
    const sortedStudents = buildSortedStudentsArray(cls.students || []);
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
          {sortedStudents.length === 0 && <Text style={styles.emptyText}>No students enrolled</Text>}
          {sortedStudents.length > 0 && (
            <ScrollView style={{ maxHeight: 5 * 56, marginTop: 6 }}>
              {sortedStudents.map((s) => (
                <View key={s.email} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
                  <Text style={styles.studentText}>{s.display}</Text>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: "#dc3545", paddingVertical: 6, paddingHorizontal: 10 }]}
                    onPress={() => removeStudentFromOpenClass(s.email)}
                  >
                    <Text style={styles.addButtonText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TextInput
            style={styles.input}
            placeholder="Enter student email"
            value={newStudentEmail}
            onChangeText={setNewStudentEmail}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddStudent}>
            <Text style={styles.addButtonText}>+ Add Student</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#17a2b8", marginTop: 8 }]}
            onPress={() => openAttendance(cls.id)}
          >
            <Text style={styles.addButtonText}>Open Attendance</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#6f42c1", marginTop: 8 }]}
            onPress={() => openAttendanceHistory(cls.id)}
          >
            <Text style={styles.addButtonText}>Attendance History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#007bff", marginTop: 8 }]}
            onPress={() => openClassChat(cls.id, user.email)}
          >
            <Text style={styles.addButtonText}>Chat</Text>
          </TouchableOpacity>
         </View>
       </View>
     );

   }

  function renderAttendance() {
    const cls = classesList.find((c) => c.id === attendanceClassId);
    if (!cls) return null;
    const sortedStudents = buildSortedStudentsArray(cls.students || []);

    // group by gender (Male first, then Female)
    const groups = { Male: [], Female: [] };
    sortedStudents.forEach((s) => {
      const uRaw = usersMap[s.email] || {};
      const u = normalizeUserRecord(uRaw, s.email);
      const g = (u.gender || "").toString().toLowerCase() === "male" ? "Male" : "Female";
      groups[g].push({ ...s, user: u });
    });

    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>
            {cls.meta.subject} — Attendance {attendanceDate}
          </Text>
          <TouchableOpacity style={styles.logoutButton} onPress={() => setView("class")}>
            <Text style={styles.logoutText}>Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ marginTop: 12 }}>
          {groups.Female.length === 0 && groups.Male.length === 0 && (
            <Text style={styles.emptyText}>No students enrolled</Text>
          )}

          {["Male", "Female"].map((label) =>
            groups[label].length > 0 ? (
              <View key={label} style={{ marginBottom: 12 }}>
                <Text style={{ fontWeight: "700", marginBottom: 6 }}>{label}</Text>
                {groups[label].map((s) => {
                  const em = s.email;
                  const present = !!attendanceState[em];
                  return (
                    <View
                      key={em}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: "#eee",
                      }}
                    >
                      <Text style={styles.studentText}>{s.display}</Text>
                      <TouchableOpacity
                        style={[
                          styles.addButton,
                          {
                            backgroundColor: present ? "#28a745" : "#6c757d",
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                          },
                        ]}
                        onPress={() => toggleAttendance(em)}
                      >
                        <Text style={styles.addButtonText}>{present ? "Present" : "Absent"}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null
          )}
        </ScrollView>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
          <TouchableOpacity
            style={[styles.addButton, { flex: 1, marginRight: 8 }]}
            onPress={() => {
              setAttendanceState({});
            }}
          >
            <Text style={styles.addButtonText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addButton, { flex: 1 }]} onPress={saveAttendance}>
            <Text style={styles.addButtonText}>Save Attendance</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // if chat open, render it on top
  if (chatOpen && chatTarget) {
    return (
      <ChatScreen
        classId={chatTarget.classId}
        ownerEmail={chatTarget.ownerEmail}
        currentUser={user}
        onClose={closeClassChat}
      />
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
    case "attendance":
      return renderAttendance();
    case "attendanceHistory":
      return renderAttendanceHistory();
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