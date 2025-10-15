import React from 'react';
import { View, StyleSheet, useWindowDimensions, Platform } from 'react-native';

/**
 * DeviceFrame
 * Wrap children to render inside a phone-like container on desktop/web.
 * On real devices the wrapper simply centers content and uses full width.
 */
export default function DeviceFrame({ children }) {
  const { width: winW, height: winH } = useWindowDimensions();

  // target phone inner size (you can change to 360x800 or 390x844)
  const PHONE_W = 390;
  const PHONE_H = 844;

  // compute scale to fit inside window with some margin
  const maxScale = Math.min((winW - 60) / PHONE_W, (winH - 80) / PHONE_H, 1);

  // on native (actual phone) don't scale down — use full screen
  const useScale = Platform.OS === 'web' ? maxScale : 1;

  return (
    <View style={styles.outer}>
      <View
        style={[
          styles.frame,
          {
            width: PHONE_W,
            height: PHONE_H,
            transform: [{ scale: useScale }],
          },
        ]}
      >
        <View style={styles.screen}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  frame: {
    borderRadius: 28,
    backgroundColor: '#111',
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    // subtle device bezel shadow
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  screen: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#FFF',
  },
});