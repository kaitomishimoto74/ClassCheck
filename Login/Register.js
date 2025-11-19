import React, { useState, useRef, useEffect } from 'react';
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
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// added: firebase register helper (non-destructive, best-effort)
import { registerWithEmailPassword, saveUserProfile } from '../src/firebase/firebaseService';

const USERS_KEY = 'users';
const AUTH_KEY = 'userToken';

export default function Register({ onRegistered, onCancel }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('Male'); // only Male / Female
  const [role, setRole] = useState('Student'); // Student | Teacher
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const fadeInAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeInAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  function validateEmail(e) {
    return /\S+@\S+\.\S+/.test(e);
  }

  async function handleRegister() {
    const f = (firstName || '').trim();
    const l = (lastName || '').trim();
    const em = (email || '').trim().toLowerCase();
    const pw = (password || '').trim();
    if (!f || !l || !em || !pw) {
      Alert.alert('Validation', 'All fields are required');
      return;
    }
    if (!validateEmail(em)) {
      Alert.alert('Validation', 'Enter a valid email');
      return;
    }

    setLoading(true);
    try {
      // attempt Firebase registration and use returned uid for profile document
      let uid = null;
      try {
        const fbUser = await registerWithEmailPassword(em, pw);
        uid = fbUser?.uid || null;
      } catch (fbErr) {
        console.warn('Firebase register failed (continuing with local save):', fbErr?.message || fbErr);
      }

      // save profile to Firestore using uid when available; fallback to email-based id if your service uses that
      try {
        const profile = { firstName: f, lastName: l, role, gender, email: em, createdAt: new Date().toISOString() };
        // saveUserProfile should accept an id (uid) or email-sanitized id depending on your firebaseService implementation
        await saveUserProfile(uid || em, profile);
      } catch (saveErr) {
        console.warn('saveUserProfile failed (continuing):', saveErr);
      }

      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : {};

      if (users[em]) {
        Alert.alert('Conflict', 'Email already registered');
        setLoading(false);
        return;
      }

      // store normalized user record with selected role
      users[em] = {
        email: em,
        password: pw,
        role: role, // selected role (Student | Teacher)
        firstName: f,
        lastName: l,
        gender: gender, // only 'Male' or 'Female'
        // classes array will be added later when enrolled
        classes: [],
        createdAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));

      // persist auth token locally so Login/flow can detect and navigate
      try {
        await AsyncStorage.setItem(AUTH_KEY, em);
      } catch (tokenErr) {
        console.warn('Failed to persist auth token locally', tokenErr);
      }

      setLoading(false);
      Alert.alert('Registered', 'Account created');

      // keep existing callback contract
      onRegistered && onRegistered(users[em]);
    } catch (e) {
      setLoading(false);
      console.warn('Local register failed', e);
      Alert.alert('Error', 'Unable to register');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF69B4" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Animated.View
        style={[
          styles.card,
          {
            opacity: fadeInAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Text style={styles.title}>Create Account</Text>

        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First Name"
          style={styles.input}
          autoCapitalize="words"
          placeholderTextColor="#999"
        />
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last Name"
          style={styles.input}
          autoCapitalize="words"
          placeholderTextColor="#999"
        />

        <Text style={{ marginBottom: 6, fontWeight: '600' }}>Role</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[
              styles.roleButton,
              role === 'Student' && styles.roleSelected,
            ]}
            onPress={() => setRole('Student')}
          >
            <Text style={styles.roleText}>Student</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleButton,
              role === 'Teacher' && styles.roleSelected,
            ]}
            onPress={() => setRole('Teacher')}
          >
            <Text style={styles.roleText}>Teacher</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ marginBottom: 6, fontWeight: '600' }}>Gender</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[
              styles.genderButton,
              gender === 'Male' && styles.genderSelected,
            ]}
            onPress={() => setGender('Male')}
          >
            <Text style={styles.genderText}>Male</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.genderButton,
              gender === 'Female' && styles.genderSelected,
            ]}
            onPress={() => setGender('Female')}
          >
            <Text style={styles.genderText}>Female</Text>
          </TouchableOpacity>
        </View>

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

        <TouchableOpacity style={styles.button} onPress={handleRegister}>
          <Text style={styles.buttonText}>
            {loading ? 'Saving...' : 'Register'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={onCancel}
        >
          <Text style={styles.secondaryText}>Back to Login</Text>
        </TouchableOpacity>
      </Animated.View>
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
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FF69B4',
    textAlign: 'center',
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  genderButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#eee',
    marginRight: 8,
  },
  genderSelected: {
    backgroundColor: '#007bff',
  },
  genderText: {
    color: '#000',
  },
  roleButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#eee',
    marginRight: 8,
  },
  roleSelected: {
    backgroundColor: '#28a745',
  },
  roleText: {
    color: '#000',
    fontWeight: '600',
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
  },
  secondaryText: {
    color: '#FF69B4',
    fontWeight: '600',
    fontSize: 16,
  },
});
