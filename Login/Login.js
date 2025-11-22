import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { registerWithEmailPassword, loginWithEmailPassword, getUserProfile, saveUserProfile } from '../src/firebase/firebaseService';
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
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    // No local credential cache: rely on Firebase auth & Firestore profile.
    setLoading(false);
  }, []);

  // SIGN IN: use Firebase auth and Firestore profile (no AsyncStorage)
  const signIn = async () => {
    if (!email || !password) {
      Alert.alert('Validation', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      // Try Firebase login first
      try {
        const fbUser = await loginWithEmailPassword((email || '').trim(), password);
        const emailKey = (email || '').trim().toLowerCase();

        // fetch profile from Firestore using uid (preferred) then fallback to email key
        let profile = null;
        try {
          profile = await getUserProfile(fbUser.uid || emailKey);
        } catch (e) {
          console.warn('getUserProfile failed', e);
        }

        // Build user object from remote profile (no local storage)
        const firstName = profile?.firstName ?? '';
        const lastName = profile?.lastName ?? '';
        const roleVal = profile?.role ?? 'Student';
        const genderVal = profile?.gender ?? null;
        const classesVal = Array.isArray(profile?.classes) ? profile.classes : [];

        const userObj = {
          email: emailKey,
          name: (firstName || lastName) ? `${firstName} ${lastName}`.trim() : '',
          role: roleVal,
          firstName,
          lastName,
          gender: genderVal,
          classes: classesVal,
          uid: fbUser?.uid || null,
        };

        setUser(userObj);

        // persist canonical profile to Firestore (merge) - no passwords stored
        try {
          await saveUserProfile(fbUser.uid || emailKey, {
            email: fbUser.email || emailKey,
            firstName,
            lastName,
            role: roleVal,
            classes: classesVal,
          });
        } catch (e) {
          console.warn('saveUserProfile after login failed', e);
        }

        setLoading(false);
        return;
      } catch (fbErr) {
        console.warn('Firebase login failed', fbErr);
        Alert.alert('Authentication failed', 'Unable to sign in. Please check your credentials and network.');
        setLoading(false);
        return;
      }
    } catch (err) {
      console.warn('signIn error', err);
      Alert.alert('Error', 'Unable to sign in. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    // clear in-memory session; Firebase signOut can be called elsewhere if needed
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
          // do not try to setSelectedRole (it doesn't exist in this component)
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

        {/* About ClassCheck button (below Create account) */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, styles.aboutButton]}
          onPress={() => setShowAbout(true)}
        >
          <Text style={[styles.secondaryText, { color: '#fff' }]}>About Us</Text>
        </TouchableOpacity>

        {/* About modal */}
        <Modal visible={showAbout} animationType="slide" transparent onRequestClose={() => setShowAbout(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>About ClassCheck</Text>
              <ScrollView contentContainerStyle={styles.modalContent}>
                <Text style={styles.paragraph}>
                  ClassCheck is a smart and modern attendance-tracking solution designed to make school management simple, accurate, and efficient. Our goal is to help teachers save time, help students stay informed, and help schools stay organized.
                </Text>
                <Text style={styles.paragraph}>
                  With built-in real-time chat, ClassCheck also improves communication between teachers and students, making class coordination easier than ever.
                </Text>
                <Text style={styles.paragraph}>
                  We believe that technology should simplify education—and ClassCheck is our step toward achieving that.
                </Text>

                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Submitted By:</Text>
                <View style={styles.aboutList}>
                  {[
                    "Aro, Kian Kenneth Torrejas",
                    "Bermoy, Ina Marie",
                    "Daan, Christopher Naquines",
                    "Docdoc, Dominique Omolon",
                    "Galleto, Almer Kilfer",
                    "Jamago, Alexandria",
                    "Lumactao, Charlene",
                    "Misiona, Jovan Mondaya",
                    "Najos, Anjeaneth Bequilla",
                    "Payot, Michael Dave",
                  ].map((n, i) => (
                    <Text key={i} style={styles.aboutItem}>• {n}</Text>
                  ))}
                </View>

                <Text style={[styles.submitToText, { marginTop: 12 }]}>Submitted To: Camelotes, Jay Ian F.</Text>
              </ScrollView>

              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowAbout(false)} activeOpacity={0.8}>
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
  aboutButton: {
    backgroundColor: '#6c757d',
    marginTop: 8,
    // subtle shadow to match theme
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '86%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'stretch',
    shadowColor: '#FF69B4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF69B4',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalContent: {
    paddingBottom: 12,
  },
  paragraph: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
    marginBottom: 8,
    textAlign: 'left',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#444',
    marginBottom: 6,
  },
  aboutList: {
    paddingLeft: 6,
  },
  aboutItem: {
    fontSize: 13,
    color: '#333',
    marginBottom: 4,
  },
  submitToText: {
    fontSize: 13,
    color: '#222',
    fontWeight: '600',
  },
  modalCloseBtn: {
    marginTop: 12,
    backgroundColor: '#FF69B4',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontWeight: '700',
  },
});
