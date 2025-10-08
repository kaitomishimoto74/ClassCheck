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

const USERS_KEY = 'users';
const AUTH_KEY = 'userToken';

export default function Register({ onRegistered, onCancel }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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

      users[email] = { name: name.trim(), password };
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
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
          value={name}
          onChangeText={setName}
          placeholder="Full Name"
          style={styles.input}
          autoCapitalize="words"
          placeholderTextColor="#999"
        />
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
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Confirm Password"
          secureTextEntry
          style={styles.input}
          placeholderTextColor="#999"
        />

        <TouchableOpacity style={styles.button} onPress={register}>
          <Text style={styles.buttonText}>Register</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={onCancel}>
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
