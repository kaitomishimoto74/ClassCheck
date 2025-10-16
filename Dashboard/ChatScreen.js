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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CLASSES_KEY = "classes";
const USERS_KEY = "users";

function genId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function convoKey(a, b) {
  const [x, y] = [a || "", b || ""].map((s) => s.toLowerCase());
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

// ChatScreen props:
// - classId
// - ownerEmail (instructor account that owns the class)
// - currentUser { email, firstName, lastName, name }
// - onClose()
export default function ChatScreen({ classId, ownerEmail, currentUser, onClose }) {
  const [usersMap, setUsersMap] = useState({});
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [participants, setParticipants] = useState([]); // [{ label, email }]
  const [recipient, setRecipient] = useState(null); // email of the other participant
  const [search, setSearch] = useState("");
  const flatRef = useRef(null);

  useEffect(() => {
    loadInitial();
  }, []);

  function displayNameForEmail(email, users = usersMap) {
    if (!email) return "";
    const u = users[email] || {};
    const first = u.firstName || (u.name ? u.name.split(" ")[0] : "");
    const last = u.lastName || "";
    const name = [first, last].filter(Boolean).join(" ");
    if (name) return name;
    return u.name || email;
  }

  async function loadInitial() {
    try {
      const rawUsers = await AsyncStorage.getItem(USERS_KEY);
      const users = rawUsers ? JSON.parse(rawUsers) : {};
      setUsersMap(users);

      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = raw ? JSON.parse(raw) : {};
      const list = Array.isArray(classes[ownerEmail]) ? classes[ownerEmail] : [];
      const cls = list.find((c) => c.id === classId) || {};

      // build participants: teacher + students (labels = First Last), exclude current user
      const parts = [];
      const teacherEmail = ownerEmail;
      const teacherName = displayNameForEmail(teacherEmail, users);
      if (teacherEmail && teacherEmail !== currentUser.email) parts.push({ label: teacherName || "Teacher", email: teacherEmail });
      const studs = Array.isArray(cls.students) ? cls.students : [];
      studs.forEach((s) => {
        const em = typeof s === "string" ? s : s?.email;
        if (em && em !== currentUser.email) parts.push({ label: displayNameForEmail(em, users) || em, email: em });
      });
      setParticipants(parts);

      // default: select first participant if any
      if (parts.length > 0) {
        setRecipient(parts[0].email);
        await loadMessagesForRecipient(parts[0].email);
      } else {
        setRecipient(null);
        setMessages([]);
      }
    } catch (e) {
      console.warn("Chat loadInitial", e);
    }
  }

  async function loadMessagesForRecipient(rec) {
    try {
      if (!rec) {
        setMessages([]);
        return;
      }
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = raw ? JSON.parse(raw) : {};
      const list = Array.isArray(classes[ownerEmail]) ? classes[ownerEmail] : [];
      const cls = list.find((c) => c.id === classId) || {};
      const key = convoKey(currentUser.email, rec);
      const priv = (cls.chatPrivate && Array.isArray(cls.chatPrivate[key])) ? [...cls.chatPrivate[key]] : [];
      priv.sort((a, b) => (a.date < b.date ? -1 : 1));
      setMessages(priv);
      setTimeout(() => flatRef.current && flatRef.current.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      console.warn("loadMessagesForRecipient", e);
    }
  }

  async function persistMessage(msg) {
    try {
      if (!msg.recipientEmail) {
        // we only persist private convos in this implementation
        return;
      }
      const raw = await AsyncStorage.getItem(CLASSES_KEY);
      const classes = raw ? JSON.parse(raw) : {};
      const list = Array.isArray(classes[ownerEmail]) ? classes[ownerEmail] : [];
      const idx = list.findIndex((c) => c.id === classId);
      if (idx === -1) return;
      const cls = { ...list[idx] };

      const key = convoKey(msg.senderEmail, msg.recipientEmail);
      const priv = (cls.chatPrivate && typeof cls.chatPrivate === "object") ? { ...cls.chatPrivate } : {};
      const arr = Array.isArray(priv[key]) ? [...priv[key]] : [];
      arr.push(msg);
      priv[key] = arr;
      cls.chatPrivate = priv;

      list[idx] = cls;
      classes[ownerEmail] = list;
      await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(classes));

      // update local messages only for currently selected recipient
      if (recipient && convoKey(currentUser.email, msg.recipientEmail) === convoKey(currentUser.email, recipient)) {
        setMessages((prev) => [...prev, msg]);
        setTimeout(() => flatRef.current && flatRef.current.scrollToEnd({ animated: true }), 80);
      }
    } catch (e) {
      console.warn("persistMessage", e);
    }
  }

  function getSenderName(email) {
    return displayNameForEmail(email);
  }

  async function handleSend() {
    const body = (text || "").trim();
    if (!body || !recipient) return;
    const msg = {
      id: genId(),
      senderEmail: currentUser.email,
      senderName: getSenderName(currentUser.email),
      recipientEmail: recipient || null,
      text: body,
      date: new Date().toISOString(),
      attachment: null,
    };
    setText("");
    await persistMessage(msg);
  }

  // attachment picker (dynamic require to avoid crash if lib not installed)
  async function handleAttach() {
    if (!recipient) {
      Alert.alert("No recipient", "Select a person to send the attachment to.");
      return;
    }
    let DocumentPicker;
    try {
      // dynamic require so app won't crash if package not present
      // install with: npm install react-native-document-picker
      DocumentPicker = require("react-native-document-picker");
    } catch (err) {
      Alert.alert("Attachment unavailable", "Install react-native-document-picker to attach files.");
      return;
    }

    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.images, DocumentPicker.types.pdf, DocumentPicker.types.plainText, DocumentPicker.types.allFiles],
      });
      if (!res) return;
      const attachment = { name: res.name || "file", uri: res.uri, type: res.type || res.mimeType || "application/octet-stream" };
      const msg = {
        id: genId(),
        senderEmail: currentUser.email,
        senderName: getSenderName(currentUser.email),
        recipientEmail: recipient || null,
        text: "",
        date: new Date().toISOString(),
        attachment,
      };
      await persistMessage(msg);
    } catch (err) {
      if (DocumentPicker.isCancel && DocumentPicker.isCancel(err)) {
        return;
      }
      console.warn("attach error", err);
    }
  }

  function renderItem({ item }) {
    const mine = item.senderEmail === currentUser.email;
    const toLabel = item.recipientEmail ? `(to ${displayNameForEmail(item.recipientEmail)})` : "";
    return (
      <View style={[styles.msgRow, mine ? styles.myMsg : styles.theirMsg]}>
        <Text style={styles.msgSender}>
          {item.senderName} {item.recipientEmail ? <Text style={{ fontSize: 12, color: "#666" }}>{toLabel}</Text> : null}
        </Text>
        {item.text ? <Text style={styles.msgText}>{item.text}</Text> : null}
        {item.attachment ? (
          <TouchableOpacity style={{ marginTop: 6 }} onPress={() => {
            // optional: don't crash — simply alert file name; implement open-file logic later
            Alert.alert(item.attachment.name || "Attachment", item.attachment.uri || "");
          }}>
            <Text style={{ color: "#007bff" }}>{item.attachment.name || "attachment"}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.msgDate}>{new Date(item.date).toLocaleString()}</Text>
      </View>
    );
  }

  const filteredParticipants = participants.filter((p) => {
    if (!search) return true;
    return (p.label || p.email).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Class Chat</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontWeight: "600", marginBottom: 6 }}>Search / Select recipient</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search people..." style={styles.searchInput} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {filteredParticipants.map((p) => (
            <TouchableOpacity
              key={p.email}
              onPress={() => { setRecipient(p.email); loadMessagesForRecipient(p.email); }}
              style={[
                styles.recipientBtn,
                recipient === p.email && styles.recipientSelected,
              ]}
            >
              <Text style={{ color: recipient === p.email ? "#fff" : "#000" }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        ref={flatRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(i) => i.id}
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
        <TouchableOpacity style={[styles.sendBtn, { marginRight: 8 }]} onPress={handleAttach}>
          <Text style={styles.sendTxt}>Attach</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendTxt}>Send</Text>
        </TouchableOpacity>
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
  msgSender: { fontSize: 12, color: "#333", fontWeight: "600" },
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