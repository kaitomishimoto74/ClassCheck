import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';

export default class ErrorBoundary extends React.Component {
  state = { error: null, info: null };

  componentDidCatch(error, info) {
    this.setState({ error, info });
    console.error(error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.errorText}>{String(this.state.error)}</Text>
          <Text style={styles.stack}>{this.state.info?.componentStack}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  errorText: { color: '#b00020', marginBottom: 8 },
  stack: { color: '#333', fontSize: 12 },
});