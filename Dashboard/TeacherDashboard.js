import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  TextInput,
  Alert,
  Modal,
  Platform,
  Linking,
  PermissionsAndroid,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// require expo-camera safely because different bundlers/versions sometimes export a module object
let CameraModule = null;
try {
  CameraModule = require("expo-camera");
} catch (e) {
  CameraModule = null;
}

// pick the Camera component (module may export Camera, default, or be namespaced)
const CameraComp = CameraModule ? (CameraModule.Camera || CameraModule.default || CameraModule) : null;

// useCameraPermissions hook fallback (if not present, provide a no-op pair)
const useCameraPermissionsHook =
  (CameraModule && CameraModule.useCameraPermissions) ? CameraModule.useCameraPermissions : () => [null, async () => ({ status: "undetermined" })];
import ChatScreen from "./ChatScreen";
import * as ImagePicker from "expo-image-picker";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

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

  // add state for bottom tab (Home | Manage | Profile)
  const [selectedTab, setSelectedTab] = useState("home");
  const [studentSearchRemove, setStudentSearchRemove] = useState("");
  
  // profile edit state
  const [profileFirstName, setProfileFirstName] = useState(user?.firstName || "");
  const [profileLastName, setProfileLastName] = useState(user?.lastName || "");
  const [profilePassword, setProfilePassword] = useState("");
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState("");
  const [profileImage, setProfileImage] = useState(user?.profileImage || null);

  // Add state for QR scanner at the top with other states
  const [scannerVisible, setScannerVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissionsHook();

  // keep explicit camera permission state (use Camera.requestCameraPermissionsAsync/getCameraPermissionsAsync)
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  // prevent multiple rapid scans from crashing app
  const [scanned, setScanned] = useState(false);

  // simulator input so scanner flow can be tested in Metro/Expo Go when native camera component isn't renderable
  const [simulateScanText, setSimulateScanText] = useState("");
  
  // Safe renderer for CameraView (prefers CameraView export). Uses onBarcodeScanned + barcodeScannerSettings.
  function SafeCameraRenderer() {
    const Cam = CameraModule && (CameraModule.CameraView || CameraModule.Camera || CameraModule.default || null);
    // render real native camera when Cam is a function/class (renderable)
    if (Cam && typeof Cam === "function") {
      try {
        return (
          <Cam
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          />
        );
      } catch (e) {
        console.warn("SafeCameraRenderer: CameraView render failed", e);
      }
    }

    // fallback simulator UI (non-crashing) for Expo Go / environments without renderable CameraView
    return (
      <View style={{ flex: 1, padding: 20, justifyContent: "center" }}>
        <Text style={{ textAlign: "center", marginBottom: 12 }}>
          Camera not available in this environment. Use the simulator below to test scanning,
          or install a dev-client / standalone APK on device to test the real camera.
        </Text>
        <TextInput
          placeholder="Paste scanned QR data (student email) here"
          placeholderTextColor="#666"
          value={simulateScanText}
          onChangeText={setSimulateScanText}
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 6,
            padding: 10,
            backgroundColor: "#fff",
            color: "#000",
            marginBottom: 10,
          }}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TouchableOpacity
          onPress={() => {
            if (!(simulateScanText || "").trim()) {
              Alert.alert("Validation", "Enter the QR payload (student email) to simulate.");
              return;
            }
            // pass same shape as expo-camera CameraView provides
            handleBarCodeScanned({ type: "qr", data: simulateScanText.trim() });
          }}
          style={{ padding: 12, backgroundColor: "#007bff", borderRadius: 6, alignItems: "center" }}
        >
          <Text style={{ color: "#fff" }}>Simulate Scan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // runtime Camera component (null until we detect a valid component)
  const [CameraComponent, setCameraComponent] = useState(null);
  useEffect(() => {
    try {
      // prefer named export Camera, then default, then module itself if it's a function
      let comp = null;
      if (CameraModule) {
        if (typeof CameraModule.Camera === "function") comp = CameraModule.Camera;
        else if (typeof CameraModule.default === "function") comp = CameraModule.default;
        else if (typeof CameraModule === "function") comp = CameraModule;
      }
      if (!comp) {
        // best-effort: if CameraModule.Camera exists but is an object, skip it (not a valid component)
        console.warn("Camera component not found as a function export; CameraModule keys:", CameraModule ? Object.keys(CameraModule) : "no-module");
      }
      setCameraComponent(comp);
    } catch (e) {
      console.warn("detect Camera component failed", e);
      setCameraComponent(null);
    }
  }, []);

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
    // check current camera permission on mount (keeps modal logic accurate)
    (async () => {
      try {
        const current = CameraModule && CameraModule.getCameraPermissionsAsync
          ? await CameraModule.getCameraPermissionsAsync()
          : { status: "undetermined", granted: false };
        let granted = !!(current && (current.granted || current.status === "granted"));

        // Android native fallback: sometimes expo-camera isn't available in Expo Go or dev-client.
        // Use PermissionsAndroid.check to detect a previously-granted permission.
        if (!granted && Platform.OS === "android") {
          try {
            const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
            granted = granted || !!ok;
          } catch (e) {
            // ignore
          }
        }

        setHasCameraPermission(!!granted);
      } catch (e) {
        // ignore, will request later
        console.warn("getCameraPermissionsAsync failed", e);
      }
    })();
    // also re-check if CameraModule becomes available later (dev reload), update CameraComponent
    try {
      if (!CameraComponent && CameraModule) {
        if (typeof CameraModule.Camera === "function") setCameraComponent(CameraModule.Camera);
        else if (typeof CameraModule.default === "function") setCameraComponent(CameraModule.default);
      }
    } catch (e) {
      // ignore
    }
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
          onPress={() => onSignOut()}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // alias for compatibility with newer UI code that calls renderHomeView
  function renderHomeView() {
    return renderHome();
  }

  async function pickProfileImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const base64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setProfileImage(base64);
      }
    } catch (e) {
      console.warn("pickProfileImage error", e);
      Alert.alert("Error", "Could not pick image");
    }
  }

  async function saveProfileChanges() {
    // allow saving profile fields (name / image) without forcing password change
    if (profilePassword && profilePasswordConfirm && profilePassword !== profilePasswordConfirm) {
      Alert.alert("Validation", "Passwords do not match");
      return;
    }

    try {
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};

      const existing = users[user.email] || {};
      const updated = {
        ...existing,
        firstName: (profileFirstName || "").trim(),
        lastName: (profileLastName || "").trim(),
        profileImage: profileImage || existing.profileImage || null,
      };
      // only change password if provided
      if (profilePassword) updated.password = profilePassword;

      users[user.email] = updated;
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));

      // update local state so UI reflects saved data
      setUsersMap(users);
      setProfileFirstName(updated.firstName || "");
      setProfileLastName(updated.lastName || "");
      setProfileImage(updated.profileImage || null);

      // clear password inputs
      setProfilePassword("");
      setProfilePasswordConfirm("");

      Alert.alert("Success", "Profile updated");
    } catch (e) {
      console.warn("saveProfileChanges error", e);
      Alert.alert("Error", "Could not save profile");
    }
  }

  // Profile view: account info + edit fields
  function renderProfileView() {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: "#fff" }}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 16 }}>Profile</Text>
          
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <TouchableOpacity
              onPress={pickProfileImage}
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: "#f0f0f0",
                justifyContent: "center",
                alignItems: "center",
                borderWidth: 2,
                borderColor: "#007bff",
              }}
            >
              {profileImage ? (
                <Image
                  source={{ uri: profileImage }}
                  style={{ width: "100%", height: "100%", borderRadius: 60 }}
                  resizeMode="cover"
                  onError={() => {
                    console.warn("Profile image failed to load");
                    setProfileImage(null);
                  }}
                />
              ) : (
                <Text style={{ fontSize: 48 }}>📷</Text>
              )}
            </TouchableOpacity>
            <Text style={{ marginTop: 10, color: "#666", fontSize: 12 }}>Tap to change photo</Text>
          </View>

          {/* Account Info */}
          <View style={{ backgroundColor: "#f8f9fa", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <Text style={{ fontWeight: "700", fontSize: 16, marginBottom: 12 }}>Account Information</Text>
            
            <Text style={{ color: "#666", fontSize: 12, marginTop: 8 }}>First Name</Text>
            <TextInput
              value={profileFirstName}
              onChangeText={setProfileFirstName}
              placeholder="First name"
              style={[styles.input, { marginTop: 4 }]}
            />

            <Text style={{ color: "#666", fontSize: 12, marginTop: 12 }}>Last Name</Text>
            <TextInput
              value={profileLastName}
              onChangeText={setProfileLastName}
              placeholder="Last name"
              style={[styles.input, { marginTop: 4 }]}
            />

            <Text style={{ color: "#666", fontSize: 12, marginTop: 12 }}>Email</Text>
            <View style={[styles.input, { marginTop: 4, justifyContent: "center" }]}>
              <Text style={{ color: "#333" }}>{user && user.email}</Text>
            </View>

            <Text style={{ color: "#666", fontSize: 12, marginTop: 12 }}>Role</Text>
            <View style={[styles.input, { marginTop: 4, justifyContent: "center" }]}>
              <Text style={{ color: "#333" }}>{user && (user.role || "Teacher")}</Text>
            </View>
          </View>

          {/* Change Password */}
          <View style={{ backgroundColor: "#f8f9fa", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <Text style={{ fontWeight: "700", fontSize: 16, marginBottom: 12 }}>Change Password</Text>
            
            <Text style={{ color: "#666", fontSize: 12, marginTop: 8 }}>New Password</Text>
            <TextInput
              value={profilePassword}
              onChangeText={setProfilePassword}
              placeholder="Enter new password"
              secureTextEntry
              style={[styles.input, { marginTop: 4 }]}
            />

            <Text style={{ color: "#666", fontSize: 12, marginTop: 12 }}>Confirm Password</Text>
            <TextInput
              value={profilePasswordConfirm}
              onChangeText={setProfilePasswordConfirm}
              placeholder="Confirm password"
              secureTextEntry
              style={[styles.input, { marginTop: 4 }]}
            />
          </View>

          {/* Save & Sign Out */}
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#007bff", marginBottom: 12 }]}
            onPress={saveProfileChanges}
          >
            <Text style={styles.addButtonText}>Save Changes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#dc3545" }]}
            onPress={() => onSignOut && onSignOut()}
          >
            <Text style={styles.addButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // bottom nav UI (mobile-friendly) — ensure nav always takes effect by clearing overlays / views
  function handleNavPress(tab) {
    // switch selected tab
    setSelectedTab(tab);
    // move to top-level manage view so mainContent will render selectedTab
    setView("manage");
    // close any open chat overlay so nav is responsive
    setChatOpen(false);
    setChatTarget(null);
    // clear open class detail so we return to top-level
    setOpenClassId(null);
  }

  function renderBottomNav() {
    const itemStyle = (active) => ({
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
      backgroundColor: active ? "#eef6ff" : "#fff",
    });
    const iconStyle = (active) => ({ fontSize: 18, color: active ? "#007bff" : "#666" });
    const labelStyle = (active) => ({ fontSize: 12, color: active ? "#007bff" : "#666", marginTop: 4 });

    return (
      <View style={{ height: 64, flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee", backgroundColor: "#fff" }}>
        <TouchableOpacity style={itemStyle(selectedTab === "home")} onPress={() => handleNavPress("home")}>
          <Text style={iconStyle(selectedTab === "home")}>🏠</Text>
          <Text style={labelStyle(selectedTab === "home")}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={itemStyle(selectedTab === "manage")} onPress={() => handleNavPress("manage")}>
          <Text style={iconStyle(selectedTab === "manage")}>📚</Text>
          <Text style={labelStyle(selectedTab === "manage")}>Manage</Text>
        </TouchableOpacity>

        <TouchableOpacity style={itemStyle(selectedTab === "profile")} onPress={() => handleNavPress("profile")}>
          <Text style={iconStyle(selectedTab === "profile")}>👤</Text>
          <Text style={labelStyle(selectedTab === "profile")}>Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }
 
   function renderManage() {
     const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || "Teacher";
     return (
       <View style={styles.container}>
  
         <Text style={[styles.header, { marginTop: 8 }]}>Manage Classes</Text>
         <TouchableOpacity
           style={styles.addButton}
           onPress={() => setView("class")}
         >
           <Text style={styles.addButtonText}>Add Class</Text>
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
            placeholderTextColor="#666"
            value={subject}
            onChangeText={setSubject}
          />
          <TextInput
            style={styles.input}
            placeholder="Department"
            placeholderTextColor="#666"
            value={department}
            onChangeText={setDepartment}
          />
          <TextInput
            style={styles.input}
            placeholder="Year Level"
            placeholderTextColor="#666"
            value={yearLevel}
            onChangeText={setYearLevel}
          />
          <TextInput
            style={styles.input}
            placeholder="Block"
            placeholderTextColor="#666"
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

    const sortedStudents = buildSortedStudentsArray(cls.students || []);
    const filteredStudents = (studentSearchRemove || "").trim()
      ? sortedStudents.filter((s) => s.display.toLowerCase().includes(studentSearchRemove.toLowerCase()))
      : [];

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
          <TextInput
            value={studentSearchRemove}
            onChangeText={setStudentSearchRemove}
            placeholder="Search student to remove..."
            style={[styles.input, { marginTop: 8 }]}
          />
          <ScrollView style={{ maxHeight: 200, marginTop: 8 }}>
            {filteredStudents.length === 0 ? (
              <Text style={styles.emptyText}>{studentSearchRemove ? "No students found" : "Type to search"}</Text>
            ) : (
              filteredStudents.map((s) => (
                <View key={s.email} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
                  <Text style={styles.studentText}>{s.display}</Text>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: "#dc3545", paddingVertical: 6, paddingHorizontal: 10 }]}
                    onPress={() => removeStudentFromOpenClass(s.email)}
                  >
                    <Text style={styles.addButtonText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
           )}
          </ScrollView>

          <TextInput
            style={styles.input}
            placeholder="Enter student email"
            value={newStudentEmail}
            onChangeText={setNewStudentEmail}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddStudent}>
            <Text style={styles.addButtonText}>Add Student</Text>
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

  async function requestScannerPermission() {
    try {
      let res = { status: "undetermined", granted: false };
      let granted = false;

      if (CameraModule && CameraModule.requestCameraPermissionsAsync) {
        res = await CameraModule.requestCameraPermissionsAsync();
        granted = !!(res && (res.granted || res.status === "granted"));
      } else if (Platform.OS === "android") {
        // fallback to native PermissionsAndroid request when expo-camera API not present
        try {
          const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
          granted = r === PermissionsAndroid.RESULTS.GRANTED;
        } catch (e) {
          granted = false;
        }
      } else {
        granted = false;
      }
       setHasCameraPermission(granted);
       if (!granted) {
         Alert.alert(
           "Camera permission",
           "Camera permission is required to scan QR codes. Open app settings to allow it.",
           [
             { text: "Open settings", onPress: () => Linking.openSettings() },
             { text: "Cancel", style: "cancel" },
           ]
         );
         return false;
       }
       return true;
     } catch (e) {
       console.warn("requestScannerPermission", e);
       Alert.alert("Permission error", "Could not request camera permission. Open app settings to enable it.");
       return false;
     }
   }

   async function openQrScanner() {
     const ok = await requestScannerPermission();
     if (!ok) return;
     // reset scanned flag before opening
     setScanned(false);
     setScannerVisible(true);
   }
 
   function handleBarCodeScanned({ data }) {
    if (scanned) return;
    setScanned(true);
    try {
      const studentEmail = (data || "").trim().toLowerCase();
      const cls = classesList.find((c) => c.id === attendanceClassId);
      if (!cls) {
        Alert.alert("Error", "Class not found");
        setTimeout(() => setScannerVisible(false), 200);
        return;
      }
      const isEnrolled = (cls.students || []).some((s) => {
        const em = typeof s === "string" ? s : s?.email;
        return em === studentEmail;
      });
      if (!isEnrolled) {
        Alert.alert("Not enrolled", `${studentEmail} is not in this class`);
        setTimeout(() => setScannerVisible(false), 200);
        return;
      }
      setAttendanceState((prev) => ({ ...prev, [studentEmail]: true }));
      Alert.alert("Success", `${studentEmail} marked present`);
      // close after short delay so alert + camera teardown don't race
      setTimeout(() => setScannerVisible(false), 300);
    } catch (err) {
      console.warn("handleBarCodeScanned error", err);
      setTimeout(() => setScannerVisible(false), 200);
    }
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
          <TouchableOpacity
            onPress={openQrScanner}
            style={{
              backgroundColor: "#007bff",
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 6,
              marginRight: 8,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>📷 Scan</Text>
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

        {/* QR Scanner Modal with Camera */}
        <Modal visible={scannerVisible} transparent={false} onRequestClose={() => setScannerVisible(false)}>
          <View style={{ flex: 1 }}>
            {(hasCameraPermission || (permission && permission.granted)) ? (
              <SafeCameraRenderer />
            ) : (
               <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
                 <Text style={{ marginBottom: 12, textAlign: "center" }}>
                   Camera permission is required to scan QR codes.
                 </Text>
                <TouchableOpacity
                  onPress={async () => {
                    const ok = await requestScannerPermission();
                    if (ok) {
                      // reopen camera
                      setTimeout(() => setScannerVisible(true), 300);
                    }
                  }}
                  style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#007bff", borderRadius: 6 }}
                >
                  <Text style={{ color: "#fff" }}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            )}
             <TouchableOpacity
              onPress={() => setScannerVisible(false)}
              style={{
                position: "absolute",
                top: 40,
                right: 20,
                padding: 10,
                backgroundColor: "#fff",
                borderRadius: 6,
              }}
            >
              <Text style={{ color: "#007bff", fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // compute main content based on state but keep bottom nav always visible
  let mainContent = null;

  if (loading) {
    mainContent = (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  } else if (view === "class") {
    mainContent = renderClass();
  } else if (view === "attendance") {
    mainContent = renderAttendance();
  } else if (view === "attendanceHistory") {
    mainContent = renderAttendanceHistory();
  } else {
    // top-level tabs: home / manage / profile
    if (selectedTab === "home") {
      // renderHomeView exists (alias to renderHome)
      mainContent = typeof renderHomeView === "function" ? renderHomeView() : renderHome();
    } else if (selectedTab === "manage") {
      mainContent = renderManage();
    } else if (selectedTab === "profile") {
      mainContent = renderProfileView();
    } else {
      mainContent = renderManage();
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {mainContent}

      {/* Chat overlay: rendered above content but above the bottom nav.
          Keep nav permanent by constraining chat to area above nav (nav height ~=64). */}
      {chatOpen && chatTarget ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 64 }}>
          <ChatScreen
            classId={chatTarget.classId}
            ownerEmail={chatTarget.ownerEmail}
            currentUser={user}
            onClose={closeClassChat}
          />
        </View>
      ) : null}

      {/* permanent bottom navigation */}
      {renderBottomNav()}
    </View>
  );
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
    color: "#000", // ensure typed text is visible in production APK
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