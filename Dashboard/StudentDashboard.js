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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ChatScreen from "./ChatScreen";
import * as ImagePicker from "expo-image-picker";
import QRCode from "react-native-qrcode-svg";
import { uploadProfileImage, saveUserProfile, fetchClassesForStudent } from "../src/firebase/firebaseService";
import { getFirestore, collection, query, where, onSnapshot, getDocs } from "firebase/firestore";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

export default function StudentDashboard({ user, onSignOut }) {
  const classesUnsubRef = useRef(null);
  // cache to avoid repeated Firestore lookups for teacher emails
  const fetchedTeacherCacheRef = useRef(new Set());
   // normalize current user email for comparisons and remote queries
   const email = ((user && user.email) || "").toLowerCase();

  // UI / navigation
  const [selectedTab, setSelectedTab] = useState("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usersMap, setUsersMap] = useState({});
  const [allClassesMap, setAllClassesMap] = useState({});
  const [view, setView] = useState("home");
  const [selectedClass, setSelectedClass] = useState(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // profile edit state
  const [profileFirstName, setProfileFirstName] = useState(user?.firstName || "");
  const [profileLastName, setProfileLastName] = useState(user?.lastName || "");
  const [profilePassword, setProfilePassword] = useState("");
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState("");
  const [profileImage, setProfileImage] = useState(user?.profileImage || null);

  useEffect(() => {
    if (!user) {
      onSignOut && onSignOut();
    } else {
      loadData();
    }
  }, []);
  
  async function loadData() {
    setLoading(true);
    try {
      // robust AsyncStorage read: if the stored blob is too large (CursorWindow) remove it and continue.
      let users = {};
      try {
        const rawUsers = await AsyncStorage.getItem(USERS_KEY);
        if (rawUsers && rawUsers.length > 150_000) {
          // very large payloads can cause Android CursorWindow errors — drop the local cache
          console.warn("USERS_KEY too large in AsyncStorage, clearing local cache to avoid CursorWindow errors");
          await AsyncStorage.removeItem(USERS_KEY);
          users = {};
        } else {
          users = rawUsers ? JSON.parse(rawUsers) : {};
        }
      } catch (err) {
        console.warn("read USERS_KEY failed, removing corrupted cache and continuing", err);
        try { await AsyncStorage.removeItem(USERS_KEY); } catch (_) {}
        users = {};
      }
       // sanitize huge data URIs (avoid CursorWindow / large-row issues)
       Object.entries(users || {}).forEach(([k, v]) => {
         if (v && typeof v.profileImage === "string") {
           const pi = v.profileImage;
           // remove inline base64 images or extremely large values (they should be uploaded instead)
           if (pi.startsWith("data:") || pi.length > 150_000) {
             v.profileImage = null;
           }
         }
       });
      // normalize users map keys by lowercased email for consistent lookups
      const normUsers = {};
      Object.entries(users || {}).forEach(([k, v]) => {
        const em = (v && (v.email || k)) || k;
        if (em) normUsers[String(em).toLowerCase()] = v || {};
      });
      setUsersMap(normUsers);

      // read classes with similar protection
      let classes = {};
      try {
        const rawClasses = await AsyncStorage.getItem(CLASSES_KEY);
        if (rawClasses && rawClasses.length > 500_000) {
          console.warn("CLASSES_KEY too large in AsyncStorage, clearing local cache to avoid CursorWindow errors");
          await AsyncStorage.removeItem(CLASSES_KEY);
          classes = {};
        } else {
          classes = rawClasses ? JSON.parse(rawClasses) : {};
        }
      } catch (err) {
        console.warn("read CLASSES_KEY failed, removing corrupted cache and continuing", err);
        try { await AsyncStorage.removeItem(CLASSES_KEY); } catch (_) {}
        classes = {};
      }

      // helper: stable class id
      const stableId = (c, fallbackId) => {
        if (!c) return String(fallbackId || "").trim() || null;
        return c.id || c._id || (c.meta && c.meta.id) || String(fallbackId || "").trim() || null;
      };

      // normalize class owner keys and dedupe classes by stable id per owner
      const normalizedClasses = {};
      Object.entries(classes || {}).forEach(([ownerKey, arr]) => {
        const owner = (ownerKey || "").toString().toLowerCase();
        const list = Array.isArray(arr) ? arr : [];
        const byId = {};
        list.forEach((c) => {
          if (!c) return;
          const id = stableId(c);
          if (!id) return; // skip malformed entries
          // ensure stored object has canonical id field
          byId[id] = { ...c, id };
        });
        normalizedClasses[owner] = Object.values(byId);
      });
      setAllClassesMap(normalizedClasses);

      // seed with fetchClassesForStudent if available (normalizing ids)
      let mergedSeed = { ...(normalizedClasses || {}) };
      try {
        if (typeof fetchClassesForStudent === "function" && email) {
          const remoteMap = await fetchClassesForStudent(email);
          Object.entries(remoteMap || {}).forEach(([ownerKey, arr]) => {
            const owner = (ownerKey || "").toString().toLowerCase();
            const existing = Array.isArray(mergedSeed[owner]) ? mergedSeed[owner] : [];
            const byId = {};
            existing.forEach((c) => { const id = stableId(c); if (id) byId[id] = { ...c, id }; });
            (Array.isArray(arr) ? arr : []).forEach((c) => {
              if (!c) return;
              const id = stableId(c);
              if (!id) return;
              byId[id] = { ...c, id };
            });
            mergedSeed[owner] = Object.values(byId);
          });
          await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(mergedSeed));
          setAllClassesMap(mergedSeed);
        }
      } catch (e) {
        console.warn("seed remote classes failed", e);
      }

      // subscribe to Firestore classes where student email is enrolled (real-time sync)
      try {
        const db = getFirestore();
        // NOTE: array-contains requires exact match; try both lowercase and raw email just in case
        const q = query(collection(db, "classes"), where("students", "array-contains", email));
        if (classesUnsubRef.current) {
          try { classesUnsubRef.current(); } catch (_) {}
          classesUnsubRef.current = null;
        }
        const unsub = onSnapshot(q, (snap) => {
          // build remote map grouped by owner (normalize owner key)
          const remoteMap = {};
          snap.docs.forEach((d) => {
            const c = d.data() || {};
            const ownerRaw = (c.ownerEmail || c.owner || (c.meta && c.meta.owner) || "").toString().toLowerCase() || "unknown";
            const owner = ownerRaw;
            const id = d.id || stableId(c, d.id);
            if (!remoteMap[owner]) remoteMap[owner] = {};
            // ensure canonical id field
            remoteMap[owner][id] = { id, ...c };
          });

          // functional update to merge with current state (avoid stale closure)
          setAllClassesMap((prev) => {
            const base = { ...(prev || {}) };

            // merge remoteMap into base, remote takes precedence for those owners
            Object.entries(remoteMap).forEach(([owner, idMap]) => {
              const existing = Array.isArray(base[owner]) ? base[owner] : [];
              const byId = {};
              existing.forEach((c) => { const id = stableId(c); if (id) byId[id] = { ...c, id }; });
              Object.entries(idMap).forEach(([id, c]) => { if (!id) return; byId[id] = { ...c, id }; });
              base[owner] = Object.values(byId);
            });

            // also ensure no duplicate class entries across owners by id
            // build global seen set and filter duplicates (keep first occurrence)
            const seenGlobal = new Set();
            Object.keys(base).forEach((owner) => {
              base[owner] = (base[owner] || []).filter((c) => {
                const id = stableId(c);
                if (!id) return false;
                if (seenGlobal.has(id)) return false;
                seenGlobal.add(id);
                return true;
              });
            });

            // persist a copy (best-effort)
            AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(base)).catch(() => {});
            return base;
          });
        }, (err) => {
          console.warn("classes snapshot failed", err);
        });
        classesUnsubRef.current = unsub;
      } catch (e) {
        console.warn("setup classes listener failed", e);
      }

      // sync profile from stored user
      const currentUser = normUsers[email] || {};
      setProfileFirstName(currentUser.firstName || user.firstName || "");
      setProfileLastName(currentUser.lastName || user.lastName || "");
      setProfileImage(currentUser.profileImage || user.profileImage || null);
    } catch (e) {
      console.warn("load student dashboard data", e);
    } finally {
      setLoading(false);
    }
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
    try {
      // load current map (best-effort; guard against CursorWindow)
      let users = {};
      try {
        const raw = await AsyncStorage.getItem(USERS_KEY);
        users = raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.warn("read USERS_KEY failed in saveProfileChanges, continuing with empty map", e);
        users = {};
      }

      const existing = users[user.email] || {};
      const updated = { ...existing, firstName: profileFirstName, lastName: profileLastName };

      // If user selected a data URI image, upload first and replace with URL before persisting.
      if (profileImage && typeof profileImage === "string" && profileImage.startsWith("data:") && typeof uploadProfileImage === "function") {
        try {
          const url = await uploadProfileImage(user.uid || user.email, profileImage);
          updated.profileImage = url || null;
        } catch (e) {
          console.warn("uploadProfileImage failed in StudentDashboard", e);
          // avoid storing the large data URI locally; fallback to existing image if any
          updated.profileImage = existing.profileImage || null;
        }
      } else {
        // not a data-uri: accept as-is (likely already a URL) or null
        updated.profileImage = profileImage || existing.profileImage || null;
      }

      // persist sanitized map (ensure we do not store raw data URIs)
      users[user.email] = updated;
      try {
        await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
      } catch (e) {
        console.warn("saving USERS_KEY failed (possibly too large), skipping local cache", e);
      }
      // update local state with normalized key
      setUsersMap((prev) => ({ ...(prev || {}), [user.email.toLowerCase()]: updated }));

      // save to remote user profile if helper exists
      if (typeof saveUserProfile === "function") {
        try { await saveUserProfile(user.uid || user.email, updated); } catch (e) { console.warn("saveUserProfile failed in StudentDashboard", e); }
      }
      Alert.alert("Saved", "Profile saved");
    } catch (e) {
      console.warn("saveProfile error", e);
      Alert.alert("Error", "Could not save profile");
    }
  }

  // gather classes where this student is enrolled
  const classesForStudent = useMemo(() => {
    const res = [];
    const seen = new Set();
    Object.entries(allClassesMap || {}).forEach(([ownerEmail, arr]) => {
      const owner = (ownerEmail || "").toString().toLowerCase();
      const list = Array.isArray(arr) ? arr : [];
      list.forEach((c) => {
        if (!c) return;
        const classId = c.id || JSON.stringify(c);
        // avoid pushing duplicate class ids
        if (seen.has(classId)) return;
        const students = Array.isArray(c.students) ? c.students : [];
        const found = students.some((s) => {
          const em = typeof s === "string" ? s : s?.email;
          return (typeof em === "string" ? em.toLowerCase() : "") === email;
        });
        if (found) {
          seen.add(classId);
          res.push({ cls: c, ownerEmail: owner });
        }
      });
    });
    res.sort((a, b) => {
      const A = (a.cls.meta?.subject || "").toLowerCase();
      const B = (b.cls.meta?.subject || "").toLowerCase();
      if (A !== B) return A < B ? -1 : 1;
      return (a.cls.id || "").localeCompare(b.cls.id || "");
    });
    return res;
  }, [allClassesMap, email]);

  // fetch user document by email and merge into usersMap (background)
  async function fetchAndCacheUserByEmail(emailToFetch) {
    if (!emailToFetch) return;
    const em = String(emailToFetch).toLowerCase();
    if (usersMap[em] || fetchedTeacherCacheRef.current.has(em)) return;
    fetchedTeacherCacheRef.current.add(em);
    try {
      const db = getFirestore();
      const q = query(collection(db, "users"), where("email", "==", em));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const u = docSnap.data() || {};
        // merge into usersMap (keep normalized lowercase email key)
        setUsersMap((prev) => ({ ...(prev || {}), [em]: u }));
      }
    } catch (err) {
      // ignore background fetch errors
      console.warn("fetchAndCacheUserByEmail failed", err);
    }
  }

  function getTeacherDisplay(ownerEmail, cls) {
    // prefer explicit instructor metadata if present
    const meta = cls && cls.meta ? cls.meta : {};
    let instructorRaw = meta.instructor || meta.instructorEmail || ownerEmail || "";
    // if meta.instructor looks like a full name (has space), prefer it
    if (typeof meta.instructor === "string" && meta.instructor.trim().includes(" ")) {
      return meta.instructor.trim();
    }

    const key = (String(instructorRaw || ownerEmail || "")).toLowerCase();
    const t = usersMap[key] || {};

    // If we have explicit first/last use them
    if (t.firstName || t.lastName) {
      return `${(t.firstName || "").trim()} ${(t.lastName || "").trim()}`.trim();
    }
    if (t.name) return t.name;

    // If class metadata contains instructor name fields, use them
    if (meta.instructorFirstName || meta.instructorLastName || meta.instructorName) {
      const candidate = `${(meta.instructorFirstName || "").trim()} ${(meta.instructorLastName || "").trim()}`.trim() || (meta.instructorName || "");
      if (candidate) return candidate;
    }

    // show a friendly fallback instead of raw email:
    // if email-like, show part before '@' with capitalization
    if (key.includes("@")) {
      const local = key.split("@")[0].replace(/[._\-]/g, " ");
      const human = local.split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      // background fetch user document to replace fallback soon
      fetchAndCacheUserByEmail(key).catch(() => {});
      return human;
    }

    // last resort: trigger background fetch and show ownerEmail as-is
    fetchAndCacheUserByEmail(key).catch(() => {});
    return String(instructorRaw || ownerEmail || "Teacher");
  }

  function gatherDatesForClass(c) {
    const att = c.attendance || {};
    const hist = Array.isArray(c.attendanceHistory) ? c.attendanceHistory.map((h) => h.date) : [];
    const dates = new Set(Object.keys(att || {}));
    hist.forEach((d) => dates.add(d));
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
    setView("classDetail");
  }

  function closeClassDetail() {
    setSelectedClass(null);
    setView("myClasses");
  }

  function openClassChat(cls, ownerEmail) {
    setChatTarget({ classId: cls.id, ownerEmail });
    setChatOpen(true);
  }

  function closeClassChat() {
    setChatOpen(false);
    setChatTarget(null);
  }

  function handleNavPress(tab) {
    setSelectedTab(tab);
    if (tab === "home") {
      setView("home");
    } else if (tab === "myClasses") {
      setView("myClasses");
    } else if (tab === "profile") {
      setView("profile");
    }
    setSelectedClass(null);
  }

  function renderHome() {
    const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || "Student";
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerGreeting}>Hello, {firstName}</Text>
        </View>

        <ScrollView style={{ marginTop: 20 }}>
          {/* Welcome Message */}
          <View style={{ backgroundColor: "#e6f3ff", padding: 16, borderRadius: 10, marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Welcome to ClassCheck</Text>
            <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>
              Track your attendance across all your classes. Tap on "My Classes" to view your enrolled courses and attendance records.
            </Text>
          </View>

          {/* Quick Actions */}
          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 10 }}>Quick Actions</Text>
          <TouchableOpacity
            style={{ padding: 16, backgroundColor: "#f8f9fa", borderRadius: 10, marginBottom: 12, flexDirection: "row", alignItems: "center" }}
            onPress={() => handleNavPress("myClasses")}
          >
            <Text style={{ fontSize: 24, marginRight: 12 }}>📚</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600" }}>My Classes</Text>
              <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>View all enrolled classes</Text>
            </View>
            <Text style={{ fontSize: 18 }}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ padding: 16, backgroundColor: "#f8f9fa", borderRadius: 10, flexDirection: "row", alignItems: "center" }}
            onPress={() => handleNavPress("profile")}
          >
            <Text style={{ fontSize: 24, marginRight: 12 }}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600" }}>Edit Profile</Text>
              <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Update your information</Text>
            </View>
            <Text style={{ fontSize: 18 }}>→</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  function renderMyClasses() {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    const firstName = (user && (user.firstName || (user.name ? user.name.split(" ")[0] : null))) || user.email;
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          
        </View>

        <Text style={[styles.header, { marginTop: 12 }]}>My Classes</Text>
        <ScrollView style={{ marginTop: 8 }}>
          {classesForStudent.length === 0 && <Text style={styles.emptyText}>You are not enrolled in any classes</Text>}
          {classesForStudent.map(({ cls, ownerEmail }) => {
             const stats = computeStats(cls);
             const teacher = getTeacherDisplay(ownerEmail, cls);
             return (
              <View key={`${(ownerEmail || "").toString().toLowerCase()}:${cls.id}`} style={styles.classItem}>
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

  function renderClassDetail() {
    if (!selectedClass) return null;

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

        <ScrollView style={{ marginTop: 12 }}>
          <View style={styles.card}>
            <Text style={styles.metaText}>
              {c.meta?.department} - {c.meta?.yearLevel} {c.meta?.block}
            </Text>
            <Text style={{ marginTop: 8 }}>Teacher: {teacher}</Text>
            <Text style={{ marginTop: 8, fontWeight: "600" }}>
              Present: {stats.present} · Absent: {stats.absent} · Total classes: {stats.total}
            </Text>

            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <TouchableOpacity style={[styles.viewButton, { backgroundColor: "#17a2b8" }]} onPress={() => openClassChat(c, selectedClass.ownerEmail)}>
                <Text style={styles.viewButtonText}>Chat</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[styles.subheader, { marginTop: 12 }]}>Attendance Records</Text>
          {dates.length === 0 && <Text style={styles.emptyText}>No attendance recorded yet</Text>}
          {dates.map((d) => {
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

  function renderProfile() {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: "#fff" }}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 16 }}>Profile</Text>

          {/* Profile Picture */}
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
              <Text style={{ color: "#333" }}>Student</Text>
            </View>
          </View>

          {/* QR Code Button */}
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: "#17a2b8", marginBottom: 16 }]}
            onPress={() => setQrModalVisible(true)}
          >
            <Text style={styles.addButtonText}>📱 View My QR Code</Text>
          </TouchableOpacity>

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

  function renderQrModal() {
    const studentName = `${profileFirstName} ${profileLastName}`.trim() || user.email;
    
    return (
      <Modal visible={qrModalVisible} transparent={true} animationType="fade" onRequestClose={() => setQrModalVisible(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.8)",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: "#fff",
              padding: 24,
              borderRadius: 12,
              alignItems: "center",
              width: "100%",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Your QR Code</Text>
            <Text style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>{studentName}</Text>

            {/* QR Code */}
            <View
              style={{
                padding: 16,
                backgroundColor: "#fff",
                borderWidth: 2,
                borderColor: "#007bff",
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <QRCode
                value={user.email}
                size={220}
                color="black"
                backgroundColor="white"
              />
            </View>

            <Text style={{ fontSize: 12, color: "#666", textAlign: "center", marginBottom: 20 }}>
              This QR code is permanent and unique to your account. Teachers can scan this to mark your attendance.
            </Text>

            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: "#007bff", width: "100%" }]}
              onPress={() => setQrModalVisible(false)}
            >
              <Text style={styles.addButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
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

        <TouchableOpacity style={itemStyle(selectedTab === "myClasses")} onPress={() => handleNavPress("myClasses")}>
          <Text style={iconStyle(selectedTab === "myClasses")}>📚</Text>
          <Text style={labelStyle(selectedTab === "myClasses")}>My Classes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={itemStyle(selectedTab === "profile")} onPress={() => handleNavPress("profile")}>
          <Text style={iconStyle(selectedTab === "profile")}>👤</Text>
          <Text style={labelStyle(selectedTab === "profile")}>Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // if chat is open, render chat as overlay
  if (chatOpen && chatTarget) {
    return (
      <View style={{ flex: 1 }}>
        <ChatScreen
          classId={chatTarget.classId}
          ownerEmail={chatTarget.ownerEmail}
          currentUser={user}
          onClose={closeClassChat}
        />
        {renderBottomNav()}
      </View>
    );
  }

  let mainContent = null;

  if (view === "home") {
    mainContent = renderHome();
  } else if (view === "myClasses") {
    mainContent = renderMyClasses();
  } else if (view === "classDetail") {
    mainContent = renderClassDetail();
  } else if (view === "profile") {
    mainContent = renderProfile();
  } else {
    mainContent = renderHome();
  }

  return (
    <View style={{ flex: 1 }}>
      {mainContent}
      {renderQrModal()}
      {renderBottomNav()}
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
});
