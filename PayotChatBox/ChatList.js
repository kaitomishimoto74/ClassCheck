import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const ChatList = ({ navigation }) => {
  const chats = [
    { id: '1', teacherName: 'Mr. Santos', subjectName: 'Mathematics', image: null },
    { id: '2', teacherName: 'Ms. Cruz', subjectName: 'English', image: null },
    { id: '3', teacherName: 'Dr. Ramirez', subjectName: 'Science', image: null }
  ];

  const renderItem = ({ item }) => {
    const initials = item.teacherName
      .split(' ')
      .map(word => word[0])
      .join('');

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() =>
          navigation.navigate('ChatBox', {
            teacherName: item.teacherName,
            subjectName: item.subjectName
          })
        }
      >
        <View style={styles.card}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.avatar} />
          ) : (
            <LinearGradient
              colors={['#2196F3', '#64B5F6']}
              style={styles.avatarPlaceholder}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </LinearGradient>
          )}

          <View style={styles.textContainer}>
            <Text style={styles.teacherName}>{item.teacherName}</Text>
            <Text style={styles.subjectName}>{item.subjectName}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient
      colors={['#E3F2FD', '#BBDEFB']}
      style={styles.container}
    >
      <Text style={styles.header}>Messages</Text>
      <FlatList
        data={chats}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
      />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20
  },
  header: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0D47A1',
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 1
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5
  },
  avatar: {
    width: 55,
    height: 55,
    borderRadius: 27.5
  },
  avatarPlaceholder: {
    width: 55,
    height: 55,
    borderRadius: 27.5,
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold'
  },
  textContainer: {
    marginLeft: 15
  },
  teacherName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1976D2'
  },
  subjectName: {
    fontSize: 14,
    color: '#555'
  }
});

export default ChatList;