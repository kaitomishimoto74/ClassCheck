import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const USERS_KEY = 'users';
const AUTH_KEY = 'userToken';

export default function Register({ onRegistered, onCancel }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const validateEmail = (e) => /\S+@\S+\.\S+/.test(e);

  const register = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('Validation', 'Please fill name, email and password.');
      return;
    }
    if (!validateEmail(email)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : {};

      if (users[email]) {
        Alert.alert('Registration', 'An account with that email already exists.');
        setLoading(false);
        return;
      }

      // NOTE: this example stores passwords in plain text for demo purposes.
      // Replace with proper hashing and secure backend for production.
      users[email] = { name: name.trim(), password };
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));

      // Auto-login after registration
      await AsyncStorage.setItem(AUTH_KEY, email);
      if (onRegistered) onRegistered({ email, name: name.trim() });
    } catch (err) {
      Alert.alert('Error', 'Unable to register. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Create account</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Full name"
        style={styles.input}
        autoCapitalize="words"
      />
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        style={styles.input}
        secureTextEntry
      />
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Confirm password"
        style={styles.input}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={register}>
        <Text style={styles.buttonText}>Register</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.ghost]} onPress={onCancel}>
        <Text style={[styles.buttonText, styles.ghostText]}>Back to login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    width: '100%',
  },
  title: { fontSize: 26, marginBottom: 12, fontWeight: '600' },
  input: {
    width: '100%',
    height: 48,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  button: {
    width: '100%',
    height: 48,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  ghost: { backgroundColor: 'transparent', borderWidth: 0, marginTop: 8 },
  ghostText: { color: '#007AFF' },
});