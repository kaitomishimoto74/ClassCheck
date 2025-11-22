import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot, arrayUnion, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
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

function idFromEmail(email = "") {
  return (email || "").toString().toLowerCase().replace(/\./g, ",");
}

// returns canonical doc id: prefer uid (if provided) otherwise sanitized email
function userDocIdFrom(input) {
  if (!input) return null;
  if (typeof input === "object") {
    if (input.uid) return String(input.uid);
    if (input.email) return idFromEmail(input.email);
  }
  // string input: if looks like email use sanitized email, otherwise use as-is (assumed uid)
  if (typeof input === "string") {
    return input.includes("@") ? idFromEmail(input) : input;
  }
  return null;
}

/**
 * Save user profile and merge duplicate docs if necessary.
 * - idOrUser: can be auth user object (has uid,email) or uid string or email string
 * - profile: object with fields to save (include email if possible)
 */
export async function saveUserProfile(idOrUser, profile = {}) {
  const db = getFirestore();
  const targetId = userDocIdFrom(idOrUser) || userDocIdFrom(profile) || null;
  if (!targetId) throw new Error("saveUserProfile: missing id/email");

  // If we have both uid and email, determine alternate id to find duplicates
  let altId = null;
  if (profile && profile.email) {
    const emailId = idFromEmail(profile.email);
    if (emailId !== targetId) altId = emailId;
  }
  // if idOrUser is uid string and profile.email present, alt exists; if idOrUser is email and a uid exists elsewhere we will detect below

  try {
    const targetRef = doc(db, "users", targetId);
    // If alternate exists, merge then delete alt
    if (altId) {
      const altRef = doc(db, "users", altId);
      const [targetSnap, altSnap] = await Promise.all([getDoc(targetRef), getDoc(altRef)]);
      const merged = {
        ...(altSnap.exists() ? altSnap.data() : {}),
        ...(targetSnap.exists() ? targetSnap.data() : {}),
        ...profile,
        email: profile.email || ((altSnap.exists() && altSnap.data().email) || (targetSnap.exists() && targetSnap.data().email)),
        updatedAt: serverTimestamp(),
      };
      // write merged to canonical target id
      await setDoc(targetRef, merged, { merge: true });
      // remove alternate to avoid future split
      if (altSnap.exists()) {
        try { await deleteDoc(altRef); } catch (e) { console.warn("saveUserProfile: failed to delete alt user doc", altId, e); }
      }
      return true;
    } else {
      // no alternate candidate known — just write/merge to targetRef
      await setDoc(targetRef, { ...profile, updatedAt: serverTimestamp() }, { merge: true });
      return true;
    }
  } catch (e) {
    console.warn("saveUserProfile error", e);
    throw e;
  }
}

/* Firestore helpers */
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
export async function getUserProfile(idOrEmail) {
  if (!db) throw new Error("Firestore not initialized");
  const docId = (idOrEmail || "").includes("@") ? (idOrEmail || "").replace(/\./g, ",") : idOrEmail;
  const snap = await getDoc(doc(db, "users", docId));
  return snap.exists() ? snap.data() : null;
}

export async function createOrUpdateClass(cls) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = doc(db, "classes", cls.id);
  await setDoc(ref, { ...cls, updatedAt: serverTimestamp() }, { merge: true });
  // also ensure teacher doc index exists (best-effort)
  try {
    const tid = idFromEmail(cls.owner || cls.ownerEmail || "");
    if (tid) {
      const tref = doc(db, "teachers", tid);
      await setDoc(tref, { classes: arrayUnion({ id: cls.id, meta: cls.meta, owner: cls.owner }) }, { merge: true });
    }
  } catch (e) {
    // ignore
  }
  return true;
}

export async function addStudentToClass(classId, studentEmail) {
  if (!db) throw new Error("Firestore not initialized");
  if (!classId) throw new Error("missing classId");
  if (!studentEmail || typeof studentEmail !== "string") throw new Error("invalid student email");

  const cref = doc(db, "classes", classId);

  // normalize email (UI already lowercases but make sure here)
  const normalizedEmail = String(studentEmail).trim().toLowerCase();

  // Find the user doc by email because users docs are keyed by uid
  const usersCol = collection(db, "users");
  const q = query(usersCol, where("email", "==", normalizedEmail));
  const qSnap = await getDocs(q);
  if (qSnap.empty) throw new Error("student user not found");
  const studentDoc = qSnap.docs[0];
  const sref = doc(db, "users", studentDoc.id);

  await runTransaction(db, async (tx) => {
    const [classSnap, studentSnap] = await Promise.all([tx.get(cref), tx.get(sref)]);
    if (!classSnap.exists()) throw new Error("class not found");
    if (!studentSnap.exists()) throw new Error("student user not found");

    const sdata = studentSnap.data() || {};
    // enforce role must be exactly "Student" (capitalized first letter)
    if (String(sdata.role || "").trim() !== "Student") throw new Error("user is not a Student");

    const cdata = classSnap.data() || {};
    // update class.students (store normalized lowercase email)
    const students = Array.isArray(cdata.students) ? [...cdata.students.map((e) => (typeof e === "string" ? e.toLowerCase() : e))] : [];
    if (!students.includes(normalizedEmail)) students.push(normalizedEmail);
    tx.update(cref, { students });

    // update student's profile so class shows up in their "My classes"
    const studentClasses = Array.isArray(sdata.classes) ? [...sdata.classes] : [];
    const classRefObj = { id: classId, owner: cdata.owner || cdata.ownerEmail || null, meta: cdata.meta || cdata.title || null };
    const alreadyAdded = studentClasses.some((c) => c && c.id === classId);
    if (!alreadyAdded) studentClasses.push(classRefObj);
    tx.set(sref, { classes: studentClasses }, { merge: true });
  });

  return true;
}

export async function markAttendance(classId, dateKey, attendanceMap) {
  if (!db) throw new Error("Firestore not initialized");
  const cref = doc(db, "classes", classId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(cref);
    if (!snap.exists()) throw new Error("class not found");
    const c = snap.data();
    const att = { ...(c.attendance || {}) };
    att[dateKey] = { ...(att[dateKey] || {}), ...(attendanceMap || {}) };
    const history = Array.isArray(c.attendanceHistory) ? [...c.attendanceHistory] : [];
    const present = Object.keys(att[dateKey]).filter((e) => att[dateKey][e]);
    const absent = Object.keys(att[dateKey]).filter((e) => !att[dateKey][e]);
    const filtered = history.filter((h) => h.date !== dateKey);
    const newHistory = [{ date: dateKey, present, absent }, ...filtered].slice(0, 365);
    tx.update(cref, { attendance: att, attendanceHistory: newHistory });
  });
  return true;
}

export async function uploadProfileImage(userIdOrEmail, base64DataUri) {
  if (!app) throw new Error("Firebase not initialized");
  const storage = getStorage(app);
  const id = idFromEmail(userIdOrEmail);
  const path = `profileImages/${id}.jpg`;
  const ref = storageRef(storage, path);
  // base64DataUri like "data:image/jpeg;base64,...."
  await uploadString(ref, base64DataUri, "data_url");
  const url = await getDownloadURL(ref);
  // persist to user profile
  try {
    await saveUserProfile(id, { profileImageUrl: url });
  } catch (e) {
    // ignore
  }
  return url;
}

export async function fetchClassesForStudent(studentEmail) {
  if (!db) throw new Error("Firestore not initialized");
  if (!studentEmail || typeof studentEmail !== "string") return {};

  const normalizedEmail = String(studentEmail).trim().toLowerCase();

  try {
    // query classes where students array contains this email (stored normalized)
    const classesCol = collection(db, "classes");
    const q = query(classesCol, where("students", "array-contains", normalizedEmail));
    const qSnap = await getDocs(q);
    const map = {};
    qSnap.forEach((docSnap) => {
      const c = { id: docSnap.id, ...(docSnap.data() || {}) };
      const owner = (c.owner || c.ownerEmail || c.meta?.instructor || "unknown").toString();
      if (!map[owner]) map[owner] = [];
      map[owner].push(c);
    });
    return map;
  } catch (e) {
    console.warn("fetchClassesForStudent failed", e);
    return {};
  }
}