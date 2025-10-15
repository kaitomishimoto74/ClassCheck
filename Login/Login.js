import React, { useEffect, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import Register from './Register';
import StudentDashboard from '../Dashboard/StudentDashboard';
import TeacherDashboard from '../Dashboard/TeacherDashboard';

const AUTH_KEY = 'userToken';
const USERS_KEY = 'users';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('Student'); // "Student" | "Instructor"
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
          const raw = await AsyncStorage.getItem(USERS_KEY);
          const users = raw ? JSON.parse(raw) : {};
          const details = users[token];
          if (details) setUser({ email: token, name: details.name, role: details.role });
        }
      } catch (e) {
        console.warn('Login init error', e);
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
      // stored role vs selectedRole must match
      if (account.role && account.role !== selectedRole) {
        Alert.alert('Authentication failed', `Selected role does not match account role (${account.role}).`);
        setLoading(false);
        return;
      }

      await AsyncStorage.setItem(AUTH_KEY, email);
      setUser({ email, name: account.name, role: account.role });
    } catch (err) {
      console.warn('signIn error', err);
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
    setSelectedRole('Student');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (user) {
    // route to role-specific dashboard
    if (user.role === 'Instructor') {
      return <TeacherDashboard user={user} onSignOut={signOut} />;
    }
    return <StudentDashboard user={user} onSignOut={signOut} />;
  }

  if (showRegister) {
    return (
      <Register
        onRegistered={(created) => {
          // after registering return to login and prefill email & role
          setShowRegister(false);
          if (created?.email) setEmail(created.email);
          if (created?.role) setSelectedRole(created.role);
          Alert.alert('Registered', 'Account created — please login.');
        }}
        onCancel={() => setShowRegister(false)}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.card}>
        <Text style={styles.title}>Login</Text>

        <View style={styles.roleRow}>
          <TouchableOpacity style={[styles.rolePill, selectedRole === 'Student' && styles.roleActive]} onPress={() => setSelectedRole('Student')}>
            <Text style={[styles.roleText, selectedRole === 'Student' && styles.roleTextActive]}>Student</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.rolePill, selectedRole === 'Instructor' && styles.roleActive]} onPress={() => setSelectedRole('Instructor')}>
            <Text style={[styles.roleText, selectedRole === 'Instructor' && styles.roleTextActive]}>Instructor</Text>
          </TouchableOpacity>
        </View>

        <TextInput value={email} onChangeText={setEmail} placeholder="Email" style={styles.input} keyboardType="email-address" autoCapitalize="none" />
        <TextInput value={password} onChangeText={setPassword} placeholder="Password" style={styles.input} secureTextEntry />

        <TouchableOpacity style={styles.button} onPress={signIn}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.ghost]} onPress={() => setShowRegister(true)}>
          <Text style={[styles.buttonText, styles.ghostText]}>Create account</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0F5' },
  container: { flex: 1, backgroundColor: '#FFF0F5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 540, backgroundColor: '#fff', padding: 20, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 4 },
  title: { fontSize: 26, marginBottom: 12, fontWeight: '700', textAlign: 'center', color: '#007AFF' },
  roleRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 12 },
  rolePill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', marginHorizontal: 6 },
  roleActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  roleText: { color: '#333' },
  roleTextActive: { color: '#fff' },
  input: { height: 46, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, marginBottom: 12 },
  button: { height: 48, backgroundColor: '#007AFF', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#007AFF' },
  ghostText: { color: '#007AFF' },
});
