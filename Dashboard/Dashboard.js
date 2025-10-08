import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Platform } from 'react-native';

export default function Dashboard({ user, onSignOut }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState('');

  const sendChat = () => {
    if (!message.trim()) {
      Alert.alert('Chat', 'Enter a message first.');
      return;
    }
    Alert.alert('Chat', 'Message sent (placeholder).');
    setMessage('');
  };

  if (chatOpen) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Chat</Text>
        <View style={styles.chatBox}>
          <Text style={{ color: '#666' }}>Chat UI placeholder</Text>
        </View>
        <TextInput style={styles.input} placeholder="Type a message..." value={message} onChangeText={setMessage} />
        <View style={{ width: '100%', flexDirection: 'row' }}>
          <TouchableOpacity style={[styles.button, { flex: 1, marginRight: 8 }]} onPress={sendChat}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: '#ccc' }]} onPress={() => setChatOpen(false)}>
            <Text style={[styles.buttonText, { color: '#000' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.sub}>Welcome, {user?.name ?? user?.email}</Text>
      <Text style={{ marginBottom: 8 }}>
        Role: <Text style={{ fontWeight: '600' }}>{user?.role ?? 'N/A'}</Text>
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => setChatOpen(true)}>
        <Text style={styles.buttonText}>Open Chat</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => Alert.alert('QR', 'QR scanner placeholder')}>
        <Text style={styles.buttonText}>QR Scanner (placeholder)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, { backgroundColor: Platform.OS === 'ios' ? '#ff3b30' : '#d9534f' }]} onPress={onSignOut}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>

      <Text style={{ marginTop: 12, color: '#999', fontSize: 12 }}>Starter scaffold — implement real screens and backend next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', width: '100%', backgroundColor: '#fff' },
  title: { fontSize: 28, marginBottom: 6, fontWeight: '600' },
  sub: { fontSize: 16, marginBottom: 12, color: '#333' },
  input: { width: '100%', height: 44, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, marginBottom: 8 },
  button: { width: '100%', height: 48, backgroundColor: '#007AFF', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  chatBox: { width: '100%', height: 220, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8 },
});