import React from 'react';
import { SafeAreaView, StyleSheet, Platform, StatusBar } from 'react-native';
import DeviceFrame from './components/DeviceFrame';
import Login from './Login/Login';

export default function App() {
  return (    
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={Platform.OS === 'ios' ? 'dark-content' : 'default'} />
      <DeviceFrame>
        <Login />
      </DeviceFrame>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EAEAEA' },
});