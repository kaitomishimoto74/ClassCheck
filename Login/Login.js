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
  Image,
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

      await AsyncStorage.setItem(AUTH_KEY, email);
      // pass full account object (normalized by Register)
      setUser({
        email,
        name: account.name || `${account.firstName || ''} ${account.lastName || ''}`.trim(),
        role: account.role || 'Student',
        firstName: account.firstName || null,
        lastName: account.lastName || null,
        gender: account.gender || null,
        classes: Array.isArray(account.classes) ? account.classes : [],
      });
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
    if ((user.role || '').toLowerCase() === 'teacher' || (user.role || '').toLowerCase() === 'instructor') {
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
        {/* App Icon */}
        <Image
          source={require('../assets/icon_1.png')}
          style={styles.icon}
          resizeMode="contain"
        />
        <Text style={styles.title}>ClassCheck</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
          placeholderTextColor="#999"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          placeholderTextColor="#999"
        />

        <TouchableOpacity style={styles.button} onPress={signIn}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => setShowRegister(true)}
        >
          <Text style={styles.secondaryText}>Create account</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0F5',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFF0F5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 16,
    shadowColor: '#FF69B4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    alignItems: 'center',
  },
  icon: {
    width: 80,
    height: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FF69B4',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    fontSize: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderColor: '#FF69B4',
    marginBottom: 20,
    color: '#333',
  },
  button: {
    backgroundColor: '#FF69B4',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#FF69B4',
    marginTop: 10,
  },
  secondaryText: {
    color: '#FF69B4',
    fontWeight: '600',
    fontSize: 16,
  },
});
