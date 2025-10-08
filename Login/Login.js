import React, { useEffect, useState, useRef } from 'react';
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
  Animated,
  Easing,
} from 'react-native';

const AUTH_KEY = 'userToken';
const USERS_KEY = 'users';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
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
        // ignore
      } finally {
        setLoading(false);
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
      }
    })();
  }, []);

  const triggerShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const signIn = async () => {
    if (!email || !password) {
      triggerShake();
      Alert.alert('Validation', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users = raw ? JSON.parse(raw) : {};
      const account = users[email];

      if (!account || account.password !== password) {
        triggerShake();
        Alert.alert('Authentication failed', 'Invalid email or password.');
        setLoading(false);
        return;
      }

      await AsyncStorage.setItem(AUTH_KEY, email);
      setUser({ email, name: account.name });
    } catch (err) {
      Alert.alert('Error', 'Login failed. Try again.');
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
        <ActivityIndicator size="large" color="#FF69B4" />
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Welcome 🎉</Text>
        <Text style={styles.sub}>Hello, {user.name ?? user.email}</Text>
        <Text style={{ marginBottom: 20, color: '#666' }}>You're logged in!</Text>
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
      <Animated.View
        style={[
          styles.card,
          {
            opacity: fadeInAnim,
            transform: [{ translateX: shakeAnim }, { scale: scaleAnim }],
          },
        ]}
      >
        <Text style={styles.title}>Login</Text>

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
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF0F5', // light pink background
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
  sub: {
    fontSize: 16,
    color: '#444',
    marginBottom: 10,
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
