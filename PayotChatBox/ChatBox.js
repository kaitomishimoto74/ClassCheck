// ChatBox.js - Pink Theme Classic Chat UI for ClassCheck
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

const ChatBox = ({ route }) => {
  const { teacherName, subjectName } = route.params;
  const currentUserId = 'student123'; // temporary ID
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const newMessage = {
      id: Date.now().toString(),
      senderId: currentUserId,
      text: inputText,
      timestamp: new Date().toISOString()
    };
    setMessages([...messages, newMessage]);
    setInputText('');
  };

  const renderItem = ({ item }) => {
    const isOwnMessage = item.senderId === currentUserId;
    return (
      <View style={[styles.messageContainer, isOwnMessage ? styles.myMessage : styles.theirMessage]}>
        <Text style={styles.messageText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <Text style={styles.header}>Chat with {teacherName} ({subjectName})</Text>

      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#999"
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF0F5', padding: 10 },
  header: { fontSize: 18, fontWeight: '700', color: '#FF69B4', marginBottom: 10, textAlign: 'center' },
  messageList: { flex: 1, marginVertical: 10 },
  messageContainer: { marginVertical: 5, padding: 10, borderRadius: 12, maxWidth: '80%' },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#FF69B4' },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#FFB6C1' },
  messageText: { fontSize: 16, color: '#333' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
 input: {
  flex: 1,
  borderWidth: 1.5,
  borderColor: '#FF69B4',
  borderRadius: 20,
  paddingHorizontal: 15,
  paddingVertical: 18, // increased height by 15px
  fontSize: 16,
  color: '#333',
  backgroundColor: '#fff'
},

  sendButton: { marginLeft: 8, backgroundColor: '#FF69B4', paddingVertical: 10, paddingHorizontal: 15, borderRadius: 20 },
  sendButtonText: { color: '#fff', fontWeight: 'bold' }
});

export default ChatBox;
