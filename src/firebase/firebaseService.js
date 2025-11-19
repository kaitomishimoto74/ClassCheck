import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  // add other firestore helpers you need here
} from "firebase/firestore";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { firebaseConfig } from "./firebaseConfig";

// DIAGNOSTICS: log essential config (redact apiKey if you share logs)
console.log("firebaseConfig keys:", Object.keys(firebaseConfig || {}));
console.log("firebaseConfig.projectId:", firebaseConfig?.projectId);
console.log("firebaseConfig.authDomain:", firebaseConfig?.authDomain);

// initialize Firebase app once
let app = null;
try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    console.log("initializeApp OK, app.name:", app?.name);
  } else {
    app = getApps()[0];
    console.log("reusing existing firebase app:", app?.name);
  }
} catch (err) {
  console.error("initializeApp failed:", err);
}

// initialize Auth with React Native persistence (AsyncStorage)
let auth = null;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
  console.log("auth initialized?", !!auth);
} catch (e) {
  console.warn("initializeAuth failed, falling back to getAuth()", e);
  // fallback (should rarely be needed)
  // eslint-disable-next-line global-require
  const { getAuth } = require("firebase/auth");
  auth = getAuth(app);
}

// initialize Firestore
let db = null;
try {
  db = getFirestore(app);
  console.log("firestore initialized?", !!db);
} catch (e) {
  console.warn("getFirestore init error", e);
}

/* AUTH helpers */
export async function registerWithEmailPassword(email, password) {
  if (!auth) throw new Error("Auth not initialized");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}
export async function loginWithEmailPassword(email, password) {
  if (!auth) throw new Error("Auth not initialized");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
export async function signOut() {
  if (!auth) return;
  await fbSignOut(auth);
}
export function onAuthChange(callback) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

/* Firestore helpers */
// helper to convert email -> safe doc id
const idFromEmail = (email = "") => (email || "").replace(/\./g, ",");

export async function saveClassesToFirestore(teacherEmail, classesList) {
  if (!db) throw new Error("Firestore not initialized");
  const id = idFromEmail(teacherEmail);
  await setDoc(doc(db, "teachers", id), { classes: classesList }, { merge: true });
  return true;
}

export function subscribeToTeacherClasses(teacherEmail, onUpdate, onError) {
  if (!db) {
    if (onError) onError(new Error("Firestore not initialized"));
    return () => {};
  }
  const id = idFromEmail(teacherEmail);
  const ref = doc(db, "teachers", id);
  const unsub = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return onUpdate([]);
      const data = snap.data();
      onUpdate(Array.isArray(data.classes) ? data.classes : []);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
  return unsub;
}

export async function markStudentPresent(teacherEmail, classId, dateKey, studentEmail) {
  if (!db) throw new Error("Firestore not initialized");
  const id = idFromEmail(teacherEmail);
  const ref = doc(db, "teachers", id);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      let classes = [];
      if (snap.exists()) classes = Array.isArray(snap.data().classes) ? snap.data().classes : [];
      const idx = classes.findIndex((c) => c.id === classId);
      if (idx === -1) throw new Error("class not found");
      const cls = { ...classes[idx] };
      cls.attendance = cls.attendance || {};
      cls.attendance[dateKey] = cls.attendance[dateKey] || {};
      cls.attendance[dateKey][studentEmail] = true;
      classes[idx] = cls;
      tx.set(ref, { classes }, { merge: true });
    });
    return true;
  } catch (e) {
    console.warn("markStudentPresent failed", e);
    return false;
  }
}

/* Save/get user profile (uses doc/setDoc already imported above) */
export async function saveUserProfile(idOrEmail, profile = {}) {
  if (!db) throw new Error("Firestore not initialized");
  const docId = (idOrEmail || "").includes("@") ? (idOrEmail || "").replace(/\./g, ",") : idOrEmail;
  await setDoc(doc(db, "users", docId), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export async function getUserProfile(idOrEmail) {
  if (!db) throw new Error("Firestore not initialized");
  const docId = (idOrEmail || "").includes("@") ? (idOrEmail || "").replace(/\./g, ",") : idOrEmail;
  const snap = await getDoc(doc(db, "users", docId));
  return snap.exists() ? snap.data() : null;
}