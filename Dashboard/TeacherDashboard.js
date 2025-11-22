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
// added: optional firestore helpers (best-effort — will not throw if missing)
import {
  subscribeToTeacherClasses,
  createOrUpdateClass,
  deleteClassFirestore,
  saveUserProfile,
  addStudentToClass,
  markStudentPresent,
  markAttendance,
  uploadProfileImage,
} from "../src/firebase/firebaseService";
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
import { updateDoc, setDoc, deleteDoc, collection, query, where, addDoc, getDocs, arrayUnion, arrayRemove, getDoc as getDocFirestore, getFirestore, doc } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";

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
  // subscription ref for Firestore listener (fixes ReferenceError)
  const classesUnsubRef = useRef(null);
  
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
      // try to subscribe to remote classes (best-effort)
      try {
        if (typeof subscribeToTeacherClasses === "function" && user?.email) {
          // store unsubscribe so cleanup can call it
          try {
            classesUnsubRef.current = subscribeToTeacherClasses(
              user.email,
              (remoteClasses) => {
                setClassesList(Array.isArray(remoteClasses) ? remoteClasses : []);
                // persist locally as cache too (non-blocking)
                AsyncStorage.getItem(CLASSES_KEY)
                  .then((raw) => {
                    const all = raw ? JSON.parse(raw) : {};
                    all[user.email] = Array.isArray(remoteClasses) ? remoteClasses : [];
                    return AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(all));
                  })
                  .catch(() => {});
              },
              (err) => console.warn("subscribeToTeacherClasses error", err)
            );
          } catch (e) {
            console.warn("subscribeToTeacherClasses init failed", e);
          }
        }
      } catch (e) {
        console.warn("subscribeToTeacherClasses init outer failed", e);
      }
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
     // cleanup classes subscription if set
     try {
       if (classesUnsubRef && classesUnsubRef.current) {
         try { classesUnsubRef.current(); } catch(_) {}
         classesUnsubRef.current = null;
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

  // normalize a user record for display/lookup (safe defaults)
  function normalizeUserRecord(raw, fallbackEmail) {
    const r = raw || {};
    const email = String(r.email || fallbackEmail || "").toLowerCase();
    const firstName = r.firstName || r.first || (r.name ? String(r.name).split(" ")[0] : "") || "";
    const lastName = r.lastName || r.last || "";
    const name = r.name || ((firstName || lastName) ? `${firstName} ${lastName}`.trim() : "") || email;
    const gender = r.gender || "";
    const uid = r.uid || r.id || "";
    return { ...r, email, firstName, lastName, name, gender, uid };
  }
  
  // build sorted students array for UI (dedupe by normalized email; prefer name fields when available)
  function buildSortedStudentsArray(students) {
    const map = new Map();

    const lookupUserByEmail = (email) => {
      const key = (email || "").toString().toLowerCase();
      return (
        usersMap[key] ||
        usersMap[email] ||
        Object.values(usersMap).find((u) => u && u.email && u.email.toLowerCase() === key) ||
        null
      );
    };

    (students || []).forEach((s) => {
      if (!s) return;
      let rawEmail = "";
      let first = "";
      let last = "";
      let name = "";

      if (typeof s === "string") {
        rawEmail = s;
      } else {
        rawEmail = s.email || s.uid || "";
        first = s.firstName || s.first || "";
        last = s.lastName || s.last || "";
        name = s.name || "";
      }

      const email = String(rawEmail || "").toLowerCase();
      const user = lookupUserByEmail(email) || (typeof s === "object" ? s : null) || {};
      // prefer explicit fields from user object if available
      const fn = first || user.firstName || user.first || (user.name ? user.name.split(" ")[0] : "") || "";
      const ln = last || user.lastName || user.last || "";
      const display = ln && fn ? `${ln}, ${fn}` : (fn || ln ? `${fn} ${ln}`.trim() : (user.name || email));

      // if map already has an entry, prefer one that contains actual names
      if (map.has(email)) {
        const existing = map.get(email);
        // replace if existing is just email but current has a proper name
        const existingLooksLikeEmail = existing.display === existing.email;
        const currentHasName = display && display !== email;
        if (currentHasName && (existingLooksLikeEmail || existing.display.length < display.length)) {
          map.set(email, { email, display });
        }
      } else {
        map.set(email, { email, display });
      }
    });

    const arr = Array.from(map.values());
    arr.sort((a, b) => (a.display || "").toString().localeCompare((b.display || "").toString()));
    return arr;
  }

  // fallback uploader using uploadString (avoids Blob/ArrayBuffer issues in RN environments)
  async function uploadProfileImageFallback(uidOrEmail, dataUrl) {
    try {
      if (!dataUrl || typeof dataUrl !== "string") throw new Error("invalid dataUrl");
      const storage = getStorage();
      const path = `profiles/${String(uidOrEmail).replace(/[@/\\]/g, "_")}/avatar.jpg`;
      const ref = storageRef(storage, path);
      // uploadString supports full data URL with 'data_url' option
      await uploadString(ref, dataUrl, "data_url");
      const url = await getDownloadURL(ref);
      return url;
    } catch (e) {
      console.warn("uploadProfileImageFallback failed", e);
      throw e;
    }
  }

  async function loadAllClasses() {
    setLoading(true);
    try {
      // Query Firestore classes owned by current teacher
      const db = getFirestore();
      const q = query(collection(db, "classes"), where("owner", "==", user?.email));
      const snap = await getDocs(q);
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClassesList(arr);

      // Best-effort: load user profiles for enrolled students
      const users = {};
      const emails = new Set();
      arr.forEach((c) => (c.students || []).forEach((s) => {
        const em = typeof s === "string" ? s : s?.email;
        if (em) emails.add(String(em).toLowerCase());
      }));

      // Query users collection by email for each enrolled student (best-effort)
      for (const em of Array.from(emails)) {
        try {
          // prefer querying by email field (users docs are keyed by uid)
          const q = query(collection(db, "users"), where("email", "==", em));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            const ud = qSnap.docs[0];
            const data = ud.data() || {};
            // store by normalized email so lookups are consistent
            users[em] = { ...data, email: data.email || em };
            continue;
          }
        } catch (e) {
          // ignore per-user query failure
        }

        // fallback: try doc lookup using the raw email string (in case some installs stored by email as doc id)
        try {
          const ud = await getDocFirestore(doc(db, "users", em));
          if (ud && ud.exists()) {
            users[em] = ud.data() || { email: em };
          }
        } catch (e) {
          // ignore
        }
      }
      setUsersMap(users);
    } catch (e) {
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
      // Update local state first
      setClassesList(Array.isArray(newList) ? newList : []);

      // Best-effort: upsert each class to Firestore so other devices sync
      if (Array.isArray(newList) && newList.length) {
        await Promise.all(
          newList.map(async (cls) => {
            try {
              if (typeof createOrUpdateClass === "function") {
                await createOrUpdateClass({ ...cls, owner: user.email });
              } else {
                // if helper missing, attempt direct write (doc id must be present)
                const db = getFirestore();
                try {
                  await updateDoc(doc(db, "classes", cls.id), { ...cls, owner: user.email });
                } catch (_) {
                  // if update fails (doc missing), try addDoc (will create new id)
                  try {
                    await addDoc(collection(db, "classes"), { ...cls, owner: user.email });
                  } catch (err) {
                    console.warn("persistClasses direct firestore write failed", err);
                  }
                }
              }
            } catch (e) {
              console.warn("createOrUpdateClass failed for", cls.id, e);
            }
          })
        );
      }
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

    // best-effort: create/update in Firestore
    if (typeof createOrUpdateClass === "function") {
      try {
        await createOrUpdateClass({ ...newClass, owner: user.email });
      } catch (e) {
        console.warn("createOrUpdateClass failed on saveClass", e);
      }
    }

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
    // show native Alert on mobile and return a Promise<boolean>
    return new Promise((resolve) => {
      try {
        Alert.alert(
          title,
          message,
          [
            { text: "Cancel", onPress: () => resolve(false), style: "cancel" },
            { text: "OK", onPress: () => resolve(true) },
          ],
          { cancelable: true }
        );
      } catch (e) {
        safeWarn("confirmDialog alert failed, defaulting to true", e);
        resolve(true);
      }
    });
  }

  // remove a class the current account manages (no Alert popups)
  async function removeClass(classId) {
    try {
      // find class in current UI state
      const cls = classesList.find((c) => c.id === classId);
      if (!cls) {
        await loadAllClasses();
        return;
      }

      const ok = await confirmDialog(
        "Remove class",
        `Remove "${cls.meta?.subject || "(no subject)"}"? This will delete the class and unenroll its students.`
      );
      if (!ok) return;

      // update local UI immediately to avoid re-creating the class on later sync
      const remaining = (classesList || []).filter((c) => c.id !== classId);
      setClassesList(remaining);

      // delete remote doc via helper or direct call
      try {
        if (typeof deleteClassFirestore === "function") {
          await deleteClassFirestore(classId);
        } else {
          const db = getFirestore();
          await deleteDoc(doc(db, "classes", classId));
        }
      } catch (e) {
        console.warn("class delete failed", e);
      }

      // ALSO remove any references to this class in the teachers collection (best-effort)
      try {
        const db = getFirestore();
        // read all teacher docs and remove any reference to the class id.
        // array-contains failed previously because teacher.classes may store objects, not plain ids.
        const tSnap = await getDocs(collection(db, "teachers"));
        await Promise.all(
          tSnap.docs.map(async (td) => {
            try {
              const tdata = td.data() || {};
              const clsArr = Array.isArray(tdata.classes) ? tdata.classes : [];
              const filtered = clsArr.filter((c) => {
                if (!c) return false;
                if (typeof c === "string") return String(c) !== String(classId);
                if (typeof c === "object") {
                  // common shapes: { id: "<id>" } or { classId: "<id>" }
                  return String(c.id || c.classId || c) !== String(classId);
                }
                return String(c) !== String(classId);
              });
              if (filtered.length !== clsArr.length) {
                await updateDoc(doc(db, "teachers", td.id), { classes: filtered });
              }
            } catch (err) {
              // ignore per-teacher failure
            }
          })
        );
      } catch (e) {
        console.warn("teacher cleanup failed", e);
      }

      // remove class refs from each student's user doc (best-effort)
      try {
        const db = getFirestore();
        if (Array.isArray(cls.students)) {
          await Promise.all(
            cls.students.map(async (s) => {
              const em = typeof s === "string" ? s : s?.email;
              if (!em) return;
              try {
                const userRef = doc(db, "users", em);
                const ud = await getDocFirestore(userRef);
                if (ud && ud.exists()) {
                  const u = ud.data();
                  const filtered = (u.classes || []).filter((cc) => String(cc.id) !== String(classId));
                  if (filtered.length !== (u.classes || []).length) {
                    await updateDoc(userRef, { classes: filtered });
                    if (typeof saveUserProfile === "function") {
                      try { await saveUserProfile(u.uid || em, { ...u, classes: filtered }); } catch (_) {}
                    }
                  }
                }
              } catch (e) {
                // ignore per-user failures
              }
            })
          );
        }
      } catch (e) {
        // ignore
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
      safeWarn("removeClass error", e);
    }
   }
  
  // remove student from open class and from user's classes (no Alert popups)
  async function removeStudentFromOpenClass(email) {
    const cls = classesList.find((c) => c.id === openClassId);
    if (!cls) return;

    const ok = await confirmDialog("Remove student", `Remove ${email} from this class?`);
    if (!ok) return;

    try {
      const db = getFirestore();
      // remove student from class.students using arrayRemove for atomic update
      try {
        if (typeof createOrUpdateClass === "function") {
          // prefer helper: fetch updated class client-side then write
          const updatedStudents = (cls.students || []).filter((s) => {
            const em = typeof s === "string" ? s : s?.email;
            return em !== email;
          });
          await createOrUpdateClass({ ...cls, students: updatedStudents, owner: user.email });
        } else {
          await updateDoc(doc(db, "classes", cls.id), { students: arrayRemove(email) });
        }
      } catch (e) {
        console.warn("remove-student remote update failed", e);
        // fallback: full write via helper
        if (typeof createOrUpdateClass === "function") {
          try {
            await createOrUpdateClass({ ...cls, owner: user.email });
          } catch (err) { console.warn(err); }
        }
      }

      // remove class reference from student's user doc (best-effort)
      try {
        const userRef = doc(db, "users", email);
        const ud = await getDocFirestore(userRef);
        if (ud && ud.exists()) {
          const u = ud.data();
          const filtered = (u.classes || []).filter((c) => String(c.id) !== String(cls.id));
          if (filtered.length !== (u.classes || []).length) {
            await updateDoc(userRef, { classes: filtered });
            if (typeof saveUserProfile === "function") {
              try { await saveUserProfile(u.uid || email, { ...u, classes: filtered }); } catch (_) {}
            }
          }
        }
      } catch (e) {
        // ignore per-user failure
      }

      setNewStudentEmail("");
      await loadAllClasses();
      const exists = (classesList || []).find((c) => c.id === cls.id);
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
    // ensure the add-student field is empty and not pre-filled by OS/autofill
    setNewStudentEmail("");
  }

  // open attendance view for a class (sets date to today)
  function openAttendance(classId) {
    setAttendanceClassId(classId);
    // prefer existing helper formatDateKey if present, otherwise build YYYY-MM-DD
    const dateKey =
      typeof formatDateKey === "function"
        ? formatDateKey()
        : (() => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
          })();
    setAttendanceDate(dateKey);
    setView("attendance");
  }

  // open attendance history view for a class
  function openAttendanceHistory(classId) {
    setAttendanceClassId(classId);
    setView("attendanceHistory");
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
    
    // declare to hold found student uid/docId
    let studentDocId = null;

    try {
      const db = getFirestore();
      // fetch latest class doc
      const classRef = doc(db, "classes", openClassId);
      const classSnap = await getDocFirestore(classRef);
      if (!classSnap || !classSnap.exists()) {
        Alert.alert("Error", "Open class not found");
        await loadAllClasses();
        return;
      }
      const cls = { id: classSnap.id, ...classSnap.data() };

      // ensure student is registered in users collection
      try {
        // find the user doc by email (users collection uses uid doc ids, not email-based ids)
        const q = query(collection(db, "users"), where("email", "==", email));
        const qSnap = await getDocs(q);
        if (qSnap.empty) {
          Alert.alert("Not registered", "Student email not found or not registered as a student");
          return;
        }
        const userDoc = qSnap.docs[0];
        const registered = userDoc.data() || {};
        studentDocId = userDoc.id; // <-- save uid/doc id for later use

        // role check: must be exactly "Student" (first letter capital)
        if (String(registered.role || "").trim() !== "Student") {
          Alert.alert("Not registered", "Student email not found or not registered as a student");
          return;
        }
      } catch (e) {
        console.warn("check user profile failed", e);
        Alert.alert("Not registered", "Student email not found");
        return;
      }
  
      // avoid duplicates
      const exists = (cls.students || []).some((s) => (typeof s === "string" ? s === email : s?.email === email));
      if (exists) {
        Alert.alert("Duplicate", "Student already in class");
        setNewStudentEmail("");
        return;
      }
  
      // Remote update: prefer helper, otherwise use atomic arrayUnion
      try {
        if (typeof addStudentToClass === "function") {
          await addStudentToClass(cls.id, email);
        } else {
          await updateDoc(classRef, { students: arrayUnion(email) });
        }
      } catch (e) {
        console.warn("addStudent remote update failed", e);
        // fallback: full write via helper
        if (typeof createOrUpdateClass === "function") {
          try {
            await createOrUpdateClass({ ...cls, students: [...(cls.students || []), email], owner: user.email });
          } catch (err) { console.warn(err); }
        }
      }
  
      // Add class meta to student user doc classes[] entry (best-effort)
      try {
        // use found studentDocId (uid) instead of email as doc id
        const userRef = doc(db, "users", studentDocId || email);
        const userSnap = await getDocFirestore(userRef);
        if (userSnap && userSnap.exists()) {
          const u = userSnap.data();
          const meta = { id: cls.id, instructor: user.email, ...(cls.meta || {}) };
          const existing = (u.classes || []).find((c) => String(c.id) === String(cls.id));
          if (!existing) {
            // write full filtered array (arrayUnion of object may not dedupe)
            const newClasses = [...(u.classes || []), meta];
            await updateDoc(userRef, { classes: newClasses });
            if (typeof saveUserProfile === "function") {
              try { await saveUserProfile(u.uid || studentDocId || email, { ...u, classes: newClasses }); } catch (_) {}
            }
          }
        }
      } catch (e) {
        // ignore per-user failure
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
      // best-effort: mark present in Firestore
      (async () => {
        try {
          const dateKey = attendanceDate || formatDateKey();
          if (typeof markStudentPresent === "function") {
            await markStudentPresent(user?.email || user?.uid, attendanceClassId, dateKey, studentEmail);
          }
        } catch (e) {
          console.warn("markStudentPresent failed", e);
        }
      })();
     // close after short delay so alert + camera teardown don't race
     setTimeout(() => setScannerVisible(false), 300);
    } catch (err) {
      console.warn("handleBarCodeScanned error", err);
      setTimeout(() => setScannerVisible(false), 200);
    }
  }

  // toggle a student's present/absent state in current attendance view
  function toggleAttendance(email) {
    setAttendanceState((prev) => {
      const next = { ...(prev || {}) };
      next[email] = !next[email];
      return next;
    });
  }

  // persist attendance for the open attendanceClassId + attendanceDate
  async function saveAttendance() {
    if (!attendanceClassId) {
      Alert.alert("Error", "No class selected");
      return;
    }

    // determine date key
    const dateKey =
      attendanceDate ||
      (typeof formatDateKey === "function"
        ? formatDateKey()
        : (() => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
          })());

    const cls = (classesList || []).find((c) => String(c.id) === String(attendanceClassId));
    if (!cls) {
      Alert.alert("Error", "Class not found");
      return;
    }

    // build attendance map (email => boolean)
    const attendanceMap = {};
    (cls.students || []).forEach((s) => {
      const em = typeof s === "string" ? s : s?.email;
      if (em) {
        attendanceMap[em] = !!attendanceState[em];
      }
    });

    // update local classesList (attendance per-date)
    try {
      const updated = (classesList || []).map((c) => {
        if (String(c.id) !== String(cls.id)) return c;
        return {
          ...c,
          attendance: { ...(c.attendance || {}), [dateKey]: attendanceMap },
        };
      });

      // persist locally + attempt remote sync
      await persistClasses(updated);

      // remote: prefer helper markAttendance, otherwise direct write to classes doc
      try {
        if (typeof markAttendance === "function") {
          await markAttendance(cls.id, dateKey, attendanceMap);
        } else {
          const db = getFirestore();
          await updateDoc(doc(db, "classes", cls.id), {
            attendance: { ...(cls.attendance || {}), [dateKey]: attendanceMap },
          });
        }
      } catch (e) {
        console.warn("saveAttendance remote update failed", e);
      }

      Alert.alert("Saved", "Attendance saved");
    } catch (e) {
      console.warn("saveAttendance failed", e);
      Alert.alert("Error", "Could not save attendance");
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

  // render attendance history list for the selected class
  function renderAttendanceHistory() {
    const cls = classesList.find((c) => c.id === attendanceClassId);
    if (!cls) return null;

    const attendance = cls.attendance || {};
    const dates = Object.keys(attendance || {}).sort((a, b) => (a < b ? 1 : -1)); // newest first

    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>
            {cls.meta?.subject} — Attendance History
          </Text>
          <TouchableOpacity onPress={() => setView("class")} style={{ padding: 8 }}>
            <Text style={{ color: "#007bff", fontWeight: "700" }}>Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ marginTop: 12 }}>
          {dates.length === 0 && <Text style={styles.emptyText}>No attendance records found</Text>}

          {dates.map((dateKey) => {
            const map = attendance[dateKey] || {};
            const total = Object.keys(map).length;
            const present = Object.values(map).filter(Boolean).length;
            const absent = Math.max(0, total - present);

            return (
              <TouchableOpacity
                key={dateKey}
                onPress={() => {
                  // pre-fill the attendanceState with recorded values so the attendance view shows statuses
                  const normalized = {};
                  Object.keys(map).forEach((k) => {
                    normalized[k] = !!map[k];
                  });
                  setAttendanceState(normalized);
                  setAttendanceDate(dateKey);
                  setAttendanceClassId(cls.id);
                  setView("attendance");
                }}
                style={{
                  padding: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View>
                  <Text style={{ fontWeight: "600" }}>{dateKey}</Text>
                  <Text style={{ color: "#666", marginTop: 4 }}>
                    {present} present · {absent} absent · {total} total
                  </Text>
                </View>
                <Text style={{ color: "#007bff", fontWeight: "700" }}>View</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }
  
  // restore renderHome (continues)...
  function renderHome() {
    const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || "Teacher";
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Hello, {firstName}</Text>
        <Text style={styles.subtitle}>Your teaching dashboard</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => onSignOut && onSignOut()}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // alias retained for compatibility with code that calls renderHomeView
  function renderHomeView() {
    return renderHome();
  }
  
  // restore navigation helpers that were removed — minimal and identical to original UI
  function handleNavPress(tab) {
    // switch selected tab and collapse overlays / open class
    setSelectedTab(tab);
    setView("manage");
    setChatOpen(false);
    setChatTarget(null);
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

  // restore renderProfileView (original-style: avatar, pick/upload, name/password fields, save, sign out)
  function renderProfileView() {
    // local image picker used by this view
    async function pickProfileImage() {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
          base64: true,
        });
        // expo-image-picker v14+ uses result.canceled + result.assets[]
        if (!result.canceled && result.assets && result.assets[0]) {
          const asset = result.assets[0];
          const base64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
          setProfileImage(base64);
        } else if (!result.cancelled && result.uri) {
          // older versions return { cancelled, uri, base64 }
          const base64 = result.base64 ? `data:image/jpeg;base64,${result.base64}` : result.uri;
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
         // keep existing local cache behavior (for backward compatibility)
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
 
         // best-effort: upload profile image (if data URI) and save to Firestore
         let profileImageUrl = updated.profileImage || null;
        if (profileImageUrl && typeof profileImageUrl === "string" && profileImageUrl.startsWith("data:")) {
          // prefer helper when available, fallback to uploadString approach if helper fails or is absent
          if (typeof uploadProfileImage === "function") {
            try {
              profileImageUrl = await uploadProfileImage(user.uid || user.email, profileImageUrl);
            } catch (e) {
              console.warn("uploadProfileImage failed, attempting fallback", e);
              try {
                profileImageUrl = await uploadProfileImageFallback(user.uid || user.email, profileImageUrl);
              } catch (err) {
                console.warn("uploadProfileImageFallback failed", err);
              }
            }
          } else {
            try {
              profileImageUrl = await uploadProfileImageFallback(user.uid || user.email, profileImageUrl);
            } catch (err) {
              console.warn("uploadProfileImageFallback failed", err);
            }
          }
        }
 
         // save to remote DB: prefer helper; fallback to direct Firestore write
         const payload = {
           firstName: updated.firstName,
           lastName: updated.lastName,
           profileImage: profileImageUrl || updated.profileImage || null,
           role: user.role || "Teacher",
         };
 
         try {
           if (typeof saveUserProfile === "function") {
             // helper should accept (id, payload) where id is uid or email
             await saveUserProfile(user.uid || user.email, payload);
           } else {
             const db = getFirestore();
             // ensure doc exists / update it
             try {
               await updateDoc(doc(db, "users", user.email), payload);
             } catch (err) {
               // if update fails (doc missing), create it
               try {
                 await setDoc(doc(db, "users", user.email), { ...payload, email: user.email });
               } catch (err2) {
                 console.warn("direct users write failed", err2);
               }
             }
           }
         } catch (e) {
           console.warn("saveUserProfile failed in saveProfileChanges", e);
         }
 
         Alert.alert("Success", "Profile updated");
       } catch (e) {
         console.warn("saveProfileChanges error", e);
         Alert.alert("Error", "Could not save profile");
       }
     }
 
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
            onPress={() => {
              if (typeof saveProfileChanges === "function") {
                saveProfileChanges();
              } else {
                Alert.alert("Not available", "Save handler is missing");
              }
            }}
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

  // restore renderManage (was removed) — shows list of classes and Add/Delete actions
  function renderManage() {
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
              <TouchableOpacity onPress={() => openClass(cls.id)} style={{ flex: 1 }}>
                <Text style={styles.classText}>{cls.meta?.subject}</Text>
                <Text style={styles.classText}>
                  {cls.meta?.department} - {cls.meta?.yearLevel} {cls.meta?.block}
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

  // restore renderClass (was accidentally removed) — supports create + open class UI
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
            placeholder="Enter student email (type manually)"
            value={newStudentEmail}
            onChangeText={setNewStudentEmail}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="none"        // disables iOS autofill suggestions
            autoComplete="off"            // RN >= 0.66
            importantForAutofill="no"     // Android autofill hint
          />

         {/* Add Student + quick actions (Open Attendance / History / Chat) */}
         <View style={{ marginTop: 12 }}>
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
      </View>
    );
  }

  // helper: return "Last, First" if available, otherwise fallback to name or email
  function getStudentDisplay(student) {
    // student may be a string email or an object { email, firstName, lastName, name, uid }
    let email = null;
    let first = null;
    let last = null;
    if (!student) return "";
    if (typeof student === "string") {
      email = student;
    } else if (typeof student === "object") {
      email = student.email || student.uid || null;
      first = student.firstName || student.first || null;
      last = student.lastName || student.last || null;
    }
    const normalizedEmail = (email || "").toString().toLowerCase();

    // try direct lookup in usersMap by email or normalized email
    const u = usersMap[normalizedEmail] || usersMap[email] || Object.values(usersMap).find((x) => (x && x.email && x.email.toLowerCase() === normalizedEmail));
    const userObj = u || (typeof student === "object" ? student : null);

    const fn = first || userObj?.firstName || userObj?.first || null;
    const ln = last || userObj?.lastName || userObj?.last || null;

    if (ln && fn) return `${ln}, ${fn}`;
    if (fn || ln) return `${fn || ""} ${ln || ""}`.trim();
    if (userObj && userObj.name) return userObj.name;
    return email || "";
  }

  let mainContent = null;
  if (view === "class") {
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