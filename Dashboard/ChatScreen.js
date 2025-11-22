import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { Camera, useCameraPermissions } from "expo-camera";

import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  getDocs,
  getDoc,
  onSnapshot,
  orderBy,
  addDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

function genId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export default function ChatScreen(props) {
  const { classId, ownerEmail, currentUser, onClose } = props;
  const [, requestPermission] = useCameraPermissions();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [participants, setParticipants] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [search, setSearch] = useState("");
  const flatRef = useRef(null);
  const messagesUnsubRef = useRef(null);

  const db = getFirestore();

  // cache fetched user profiles by email to avoid repeated queries
  const userProfileCacheRef = useRef({});

  // enrich messages with sender profileImage when missing
  async function enrichProfiles(msgs = []) {
    try {
      const missing = new Set();
      msgs.forEach((m) => {
        const em = (m.senderEmail || "").toString().toLowerCase();
        if (!em) return;
        if ((!m.senderProfile || !m.senderProfile.profileImage) && !userProfileCacheRef.current[em]) {
          missing.add(em);
        }
      });
      if (missing.size === 0) return;

      for (const em of Array.from(missing)) {
        try {
          const q = query(collection(db, "users"), where("email", "==", em));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            userProfileCacheRef.current[em] = qSnap.docs[0].data() || null;
          } else {
            userProfileCacheRef.current[em] = null;
          }
        } catch (e) {
          userProfileCacheRef.current[em] = null;
        }
      }

      // patch in-memory messages with any found profileImage
      setMessages((prev) =>
        (prev || []).map((m) => {
          const em = (m.senderEmail || "").toString().toLowerCase();
          const cached = userProfileCacheRef.current[em];
          if (cached && cached.profileImage && (!m.senderProfile || !m.senderProfile.profileImage)) {
            return { ...m, senderProfile: { ...(m.senderProfile || {}), profileImage: cached.profileImage } };
          }
          return m;
        })
      );
    } catch (err) {
      console.warn("enrichProfiles failed", err);
    }
  }

  useEffect(() => {
    loadParticipantsFromFirestore();
    return cleanupSubscription;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, ownerEmail]);

  async function loadParticipantsFromFirestore() {
    try {
      const list = [];
      if (classId) {
        const clsRef = doc(db, "classes", classId);
        const clsSnap = await getDoc(clsRef);
        if (clsSnap && clsSnap.exists()) {
          const cls = clsSnap.data() || {};
          const studs = Array.isArray(cls.students) ? cls.students : [];
          const emails = Array.from(
            new Set(
              studs
                .map((s) => (typeof s === "string" ? s.toLowerCase() : (s?.email || "").toLowerCase()))
                .filter(Boolean)
            )
          );
          if (ownerEmail) emails.push(ownerEmail.toLowerCase());
          for (const em of emails) {
            try {
              const q = query(collection(db, "users"), where("email", "==", em));
              const qSnap = await getDocs(q);
              if (!qSnap.empty) {
                const udoc = qSnap.docs[0];
                const u = udoc.data() || {};
                list.push({
                  uid: udoc.id,
                  email: (u.email || em).toLowerCase(),
                  firstName: u.firstName || "",
                  lastName: u.lastName || "",
                  profileImage: u.profileImage || null,
                  label: ((u.firstName || u.lastName) ? `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim() : (u.email || em)),
                });
                continue;
              }
            } catch (e) {
              // ignore per-user query failure
            }
            list.push({ uid: em, email: em, firstName: "", lastName: "", profileImage: null, label: em });
          }
        }
      } else if (ownerEmail) {
        const em = (ownerEmail || "").toLowerCase();
        try {
          const q = query(collection(db, "users"), where("email", "==", em));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            const udoc = qSnap.docs[0];
            const u = udoc.data() || {};
            list.push({
              uid: udoc.id,
              email: (u.email || em).toLowerCase(),
              firstName: u.firstName || "",
              lastName: u.lastName || "",
              profileImage: u.profileImage || null,
              label: ((u.firstName || u.lastName) ? `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim() : (u.email || em)),
            });
          } else {
            list.push({ uid: em, email: em, firstName: "", lastName: "", profileImage: null, label: em });
          }
        } catch (e) {
          list.push({ uid: em, email: em, firstName: "", lastName: "", profileImage: null, label: em });
        }
      }

      const map = new Map();
      const myEmail = (currentUser?.email || "").toLowerCase();
      list.forEach((p) => {
        const key = (p.email || p.uid || "").toLowerCase();
        if (!key || key === myEmail) return;
        if (!map.has(key)) map.set(key, p);
      });
      setParticipants(Array.from(map.values()));
    } catch (e) {
      console.warn("loadParticipantsFromFirestore", e);
      Alert.alert("Error", "Could not load participants");
    }
  }

  function cleanupSubscription() {
    if (messagesUnsubRef.current) {
      try { messagesUnsubRef.current(); } catch (_) {}
      messagesUnsubRef.current = null;
    }
  }

  useEffect(() => {
    cleanupSubscription();
    setMessages([]);
    if (!recipient) return;

    const peerId = recipient.uid || recipient.email;
    const myId = currentUser?.uid || currentUser?.email || "";
    const ids = [String(myId), String(peerId)].map((s) => s.toLowerCase()).sort();
    const chatId = ids.join("__");

    (async () => {
      try {
        const chatRef = doc(db, "chats", chatId);
        const snap = await getDoc(chatRef);
        if (!snap.exists()) {
          await setDoc(chatRef, {
            participants: [myId, peerId],
            participantsEmails: [currentUser?.email || "", recipient.email || ""],
            createdAt: serverTimestamp(),
          });
        }
      } catch (e) {
        // ignore
      }

      const msgsCol = collection(db, "chats", chatId, "messages");
      const q = query(msgsCol, orderBy("createdAt", "asc"));
      const unsub = onSnapshot(q, (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setMessages(rows);
        // best-effort: enrich loaded messages with profile images from users collection
        enrichProfiles(rows);
        setTimeout(() => flatRef.current && flatRef.current.scrollToEnd && flatRef.current.scrollToEnd({ animated: true }), 50);
      }, (err) => {
        console.warn("messages listen error", err);
      });
      messagesUnsubRef.current = unsub;
    })();

    return cleanupSubscription;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient]);

  function displayNameForPerson(p) {
    if (!p) return "";
    if (p.firstName || p.lastName) return `${(p.firstName || "").trim()} ${(p.lastName || "").trim()}`.trim();
    return p.label || p.email || p.uid || "";
  }

  function avatarSourceForPerson(p) {
    if (p && p.profileImage) return { uri: p.profileImage };
    return null;
  }

  async function handleSend() {
    if (!text || !text.trim() || !recipient) return;
    const body = text.trim();
    setText("");

    const peerId = recipient.uid || recipient.email;
    const myId = currentUser?.uid || currentUser?.email || "";
    const ids = [String(myId), String(peerId)].map((s) => s.toLowerCase()).sort();
    const chatId = ids.join("__");

    try {
      const msgsCol = collection(db, "chats", chatId, "messages");
      const newMsg = {
        text: body,
        senderEmail: (currentUser?.email || "").toLowerCase(),
        senderName: displayNameForPerson(currentUser) || currentUser?.email,
        recipientEmail: (recipient.email || "").toLowerCase(),
        createdAt: serverTimestamp(),
        senderProfile: {
          uid: currentUser?.uid || "",
          firstName: currentUser?.firstName || "",
          lastName: currentUser?.lastName || "",
          profileImage: currentUser?.profileImage || null,
        },
      };
      await addDoc(msgsCol, newMsg);

      const chatRef = doc(db, "chats", chatId);
      try {
        await setDoc(chatRef, {
          participants: [myId, peerId],
          participantsEmails: [currentUser?.email || "", recipient.email || ""],
          lastMessage: { text: body, from: myId, createdAt: serverTimestamp() },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn("update chat metadata failed", e);
      }
    } catch (e) {
      console.warn("send message failed", e);
      Alert.alert("Error", "Message not sent");
    }
  }

  async function handleAttach() {
    if (!recipient) {
      Alert.alert("No recipient", "Select a person to send the attachment to.");
      return;
    }
    try {
      if (Platform.OS === "web") {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (event) => {
            const base64 = event.target.result;
            await sendAttachmentMessage({ name: file.name, uri: base64, size: file.size, type: file.type || "application/octet-stream" });
          };
          reader.readAsDataURL(file);
        };
        input.click();
        return;
      }

      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      const file = res.assets ? res.assets[0] : res;
      if (!file || (file.size === 0 && !file.uri)) {
        Alert.alert("Cancelled", "No file selected");
        return;
      }
      const fileName = file.name || `file_${Date.now()}`;
      const attachment = { name: fileName, uri: file.uri, size: file.size || 0, type: file.mimeType || file.type || "application/octet-stream" };
      await sendAttachmentMessage(attachment);
      Alert.alert("Success", "File sent");
    } catch (err) {
      console.warn("attach error", err);
      Alert.alert("Attachment error", err.message || "Could not attach file.");
    }
  }

  async function sendAttachmentMessage(attachment) {
    if (!recipient) return;
    const peerId = recipient.uid || recipient.email;
    const myId = currentUser?.uid || currentUser?.email || "";
    const ids = [String(myId), String(peerId)].map((s) => s.toLowerCase()).sort();
    const chatId = ids.join("__");
    try {
      const msgsCol = collection(db, "chats", chatId, "messages");
      const newMsg = {
        text: `📎 ${attachment.name || "Attachment"}`,
        senderEmail: (currentUser?.email || "").toLowerCase(),
        senderName: displayNameForPerson(currentUser) || currentUser?.email,
        recipientEmail: (recipient.email || "").toLowerCase(),
        createdAt: serverTimestamp(),
        attachment,
        senderProfile: {
          uid: currentUser?.uid || "",
          firstName: currentUser?.firstName || "",
          lastName: currentUser?.lastName || "",
          profileImage: currentUser?.profileImage || null,
        },
      };
      await addDoc(msgsCol, newMsg);
      const chatRef = doc(db, "chats", chatId);
      await setDoc(chatRef, {
        participants: [myId, peerId],
        participantsEmails: [currentUser?.email || "", recipient.email || ""],
        lastMessage: { text: newMsg.text, from: myId, createdAt: serverTimestamp() },
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn("sendAttachmentMessage failed", e);
      Alert.alert("Error", "Attachment not sent");
    }
  }

  function renderItem({ item }) {
    const mine = ((item.senderEmail || "").toLowerCase() === (currentUser?.email || "").toLowerCase());
    const sender = item.senderProfile || {};
    // fallback to cached profile if message lacks profileImage
    const cached = userProfileCacheRef.current[(item.senderEmail || "").toLowerCase()];
    const profileImage = sender.profileImage || (cached && cached.profileImage) || null;
    const body = (item.text || "").toString();
    const initials = (() => {
      const fn = (sender.firstName || "").trim();
      const ln = (sender.lastName || "").trim();
      if (fn || ln) return (fn.charAt(0) || "") + (ln.charAt(0) || "");
      if (item.senderName) return item.senderName.split(/\s+/).map(p => p.charAt(0)).slice(0, 2).join("");
      return (item.senderEmail && item.senderEmail.charAt(0)) || "?";
    })();

    const Avatar = profileImage ? (
      <Image source={{ uri: profileImage }} style={{ width: 36, height: 36, borderRadius: 18 }} />
    ) : (
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#ddd", justifyContent: "center", alignItems: "center" }}>
        <Text style={{ fontSize: 12, color: "#444", fontWeight: "700" }}>{initials.toUpperCase()}</Text>
      </View>
    );

    const ts = item.createdAt && item.createdAt.toDate ? item.createdAt.toDate().toLocaleString() : "";

    return (
      <View style={{ flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-start", marginVertical: 6 }}>
        <View style={{ flexShrink: 0, marginLeft: mine ? 8 : 0, marginRight: mine ? 0 : 8 }}>{Avatar}</View>
        <View style={[styles.msgRow, mine ? styles.myMsg : styles.theirMsg]}>
          {body ? <Text style={styles.msgText}>{body}</Text> : null}
          {item.attachment && item.attachment.uri ? (
            <TouchableOpacity
              style={{
                marginTop: body ? 8 : 0,
                backgroundColor: mine ? "#28a745" : "#007bff",
                padding: 12,
                borderRadius: 8,
                flexDirection: "row",
                alignItems: "center",
              }}
              onPress={async () => {
                try {
                  if (Platform.OS === "web") {
                    const link = document.createElement("a");
                    link.href = item.attachment.uri;
                    link.download = item.attachment.name || "file";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    Alert.alert("Success", "File downloaded!");
                  } else {
                    if (await Sharing.isAvailableAsync()) {
                      await Sharing.shareAsync(item.attachment.uri, {
                        mimeType: item.attachment.type,
                        dialogTitle: item.attachment.name,
                      });
                    } else {
                      Alert.alert("File Info", `${item.attachment.name} - ${((item.attachment.size || 0) / 1024).toFixed(2)} KB`);
                    }
                  }
                } catch (e) {
                  console.warn("Download error", e);
                  Alert.alert("Error", "Could not download file");
                }
              }}
            >
              <Text style={{ fontSize: 20, marginRight: 8 }}>📥</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", color: "#fff", fontSize: 13 }}>{item.attachment.name || "File"}</Text>
                <Text style={{ color: mine ? "#c8e6c9" : "#b3d9ff", fontSize: 11, marginTop: 4 }}>
                  {((item.attachment.size || 0) / 1024).toFixed(2)} KB • Tap to download
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.msgDate}>{ts}</Text>
        </View>
      </View>
    );
  }

  const filteredParticipants = participants.filter((p) => {
    if (!search || !search.trim()) return false; // only show when typing
    const q = search.toLowerCase();
    return ((p.label || p.email || "").toLowerCase().includes(q));
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Class Chat</Text>
        <TouchableOpacity onPress={() => { cleanupSubscription(); onClose && onClose(); }} style={styles.closeBtn}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontWeight: "600", marginBottom: 6 }}>Search / Select recipient</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="Type to search people..." style={styles.searchInput} autoCapitalize="none" />
        {search && search.trim().length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {filteredParticipants.map((p) => (
              <TouchableOpacity
                key={p.email || p.uid}
                onPress={() => { setRecipient(p); setSearch(""); }}
                style={[
                  styles.recipientBtn,
                  (recipient && ((recipient.email || recipient.uid) === (p.email || p.uid))) && styles.recipientSelected,
                ]}
              >
                <Text style={{ color: (recipient && ((recipient.email || recipient.uid) === (p.email || p.uid))) ? "#fff" : "#000" }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <FlatList
        ref={flatRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(i) => i.id || genId()}
        contentContainerStyle={styles.list}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a message..."
          value={text}
          onChangeText={setText}
          multiline
        />
        <TouchableOpacity style={[styles.sendBtn, { marginRight: 8 }]} onPress={handleAttach}><Text style={styles.sendTxt}>Attach</Text></TouchableOpacity>
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}><Text style={styles.sendTxt}>Send</Text></TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "700" },
  closeBtn: { padding: 8 },
  closeText: { color: "#007bff" },
  list: { paddingBottom: 20 },
  msgRow: { marginVertical: 6, padding: 8, borderRadius: 8, maxWidth: "85%" },
  myMsg: { backgroundColor: "#e6ffed", alignSelf: "flex-end" },
  theirMsg: { backgroundColor: "#f1f1f1", alignSelf: "flex-start" },
  msgText: { marginTop: 4, fontSize: 15, color: "#111" },
  msgDate: { marginTop: 6, fontSize: 11, color: "#666", textAlign: "right" },
  composer: { flexDirection: "row", alignItems: "flex-end", marginTop: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fff" },
  sendBtn: { marginLeft: 8, backgroundColor: "#007bff", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  sendTxt: { color: "#fff", fontWeight: "700" },
  recipientBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "#efefef", marginRight: 8 },
  recipientSelected: { backgroundColor: "#007bff" },
  searchInput: { borderWidth: 1, borderColor: "#ddd", padding: 8, borderRadius: 8, backgroundColor: "#fff" },
});