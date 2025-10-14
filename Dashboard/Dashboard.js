import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  Platform,
} from 'react-native';

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
        <Text style={styles.title}>💬 Chat</Text>
        <View style={styles.chatBox}>
          <Text style={styles.chatPlaceholder}>Chat UI placeholder</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.sendButton]} onPress={sendChat}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.closeButton]}
            onPress={() => setChatOpen(false)}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏠 Dashboard</Text>
      <Text style={styles.sub}>Welcome, {user?.name ?? user?.email}</Text>
      <Text style={styles.roleText}>
        Role: <Text style={styles.role}>{user?.role ?? 'N/A'}</Text>
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => setChatOpen(true)}>
        <Text style={styles.buttonText}>Open Chat</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => Alert.alert('QR', 'QR scanner placeholder')}>
        <Text style={styles.buttonText}>QR Scanner (placeholder)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={onSignOut}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>

      <Text style={styles.footerNote}>
        🚧 Starter scaffold — implement real screens and backend next.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    backgroundColor: '#f9f9f9',
  },
  title: {
    fontSize: 28,
    marginBottom: 8,
    fontWeight: '700',
    color: '#222',
  },
  sub: {
    fontSize: 16,
    marginBottom: 4,
    color: '#444',
  },
  roleText: {
    fontSize: 14,
    marginBottom: 16,
    color: '#666',
  },
  role: {
    fontWeight: '600',
    color: '#007aff',
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  button: {
    width: '100%',
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: '#007aff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  sendButton: {
    flex: 1,
    marginRight: 8,
    backgroundColor: '#34c759',
  },
  closeButton: {
    flex: 1,
    backgroundColor: '#e5e5ea',
  },
  closeButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  logoutButton: {
    backgroundColor: Platform.OS === 'ios' ? '#ff3b30' : '#d9534f',
  },
  chatBox: {
    width: '100%',
    height: 220,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  chatPlaceholder: {
    color: '#999',
    fontStyle: 'italic',
  },
  row: {
    width: '100%',
    flexDirection: 'row',
  },
  footerNote: {
    marginTop: 16,
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
  },
});
