import React, { useEffect, useState } from 'react';
import Register from './Register';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

const AUTH_KEY = 'userToken';
const USERS_KEY = 'users';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
          // try to load user details from stored users
          const raw = await AsyncStorage.getItem(USERS_KEY);
          const users = raw ? JSON.parse(raw) : {};
          const details = users[token];
          if (details) {
            setUser({ email: token, name: details.name });
          } else {
            setUser({ email: token });
          }
        }
      } catch (e) {
        /* ignore for demo */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async () => {
    if (!email || !password) {
      Alert.alert('Validation', 'Please enter email and password');
      return;
    }
    setLoading(true);

    try {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : {};

      const account = users[email];
      if (!account) {
        Alert.alert('Authentication failed', 'No account found for this email.');
        setLoading(false);
        return;
      }

      if (account.password !== password) {
        Alert.alert('Authentication failed', 'Invalid credentials.');
        setLoading(false);
        return;
      }

      // success: persist auth token and set user
      await AsyncStorage.setItem(AUTH_KEY, email);
      setUser({ email, name: account.name });
    } catch (err) {
      Alert.alert('Error', 'Unable to sign in. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    setUser(null);
    setEmail('');
    setPassword('');
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.sub}>Welcome, {user.name ?? user.email}</Text>
        <Text style={{ marginBottom: 20, color: '#666' }}>This is a simple dashboard placeholder.</Text>
        <TouchableOpacity style={styles.button} onPress={signOut}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showRegister) {
    return (
      <Register
        onRegistered={(user) => {
          // user object from Register: { email, name }
          setUser(user);
          setShowRegister(false);
        }}
        onCancel={() => setShowRegister(false)}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Login</Text>
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
      <TouchableOpacity style={styles.button} onPress={signIn}>
        <Text style={styles.buttonText}>Sign In</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, { backgroundColor: '#fff', borderWidth: 0 }]} onPress={() => setShowRegister(true)}>
        <Text style={[styles.buttonText, { color: '#007AFF' }]}>Create account</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    marginBottom: 12,
    fontWeight: '600',
  },
  sub: {
    fontSize: 16,
    marginBottom: 20,
    color: '#333',
  },
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
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});