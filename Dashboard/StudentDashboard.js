import React, { useEffect, useState, useMemo } from "react";
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
import { uploadProfileImage, saveUserProfile } from "../src/firebase/firebaseService";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

export default function StudentDashboard({ user, onSignOut }) {
  const email = (user && user.email) || "";

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
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      setUsersMap(users);

      const rawClasses = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = rawClasses ? JSON.parse(rawClasses) : {};
      setAllClassesMap(classes);

      // sync profile from stored user
      const currentUser = users[email] || {};
      setProfileFirstName(currentUser.firstName || user.firstName || "");
      setProfileLastName(currentUser.lastName || user.lastName || "");
      setProfileImage(currentUser.profileImage || null);
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
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : {};
      const existing = users[user.email] || {};
      const updated = { ...existing, firstName: profileFirstName, lastName: profileLastName, profileImage: profileImage || existing.profileImage || null };
      users[user.email] = updated;
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
      setUsersMap(users);
      // upload image first if data-uri
      if (updated.profileImage && typeof updated.profileImage === "string" && updated.profileImage.startsWith("data:") && typeof uploadProfileImage === "function") {
        try {
          const url = await uploadProfileImage(user.uid || user.email, updated.profileImage);
          updated.profileImage = url || updated.profileImage;
          users[user.email] = updated;
          await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
          setUsersMap(users);
        } catch (e) {
          console.warn("uploadProfileImage failed in StudentDashboard", e);
        }
      }
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
    res.sort((a, b) => {
      const A = (a.cls.meta?.subject || "").toLowerCase();
      const B = (b.cls.meta?.subject || "").toLowerCase();
      if (A !== B) return A < B ? -1 : 1;
      return (a.cls.id || "").localeCompare(b.cls.id || "");
    });
    return res;
  }, [allClassesMap, email]);

  function getTeacherDisplay(ownerEmail, cls) {
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
