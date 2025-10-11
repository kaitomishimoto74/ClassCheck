import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Image } from 'react-native';

const ChatList = ({ navigation }) => {
  // Temporary static data (replace later with real data from backend)
  const chats = [
    { id: '1', teacherName: 'Mr. Santos', subjectName: 'Mathematics', image: null },
    { id: '2', teacherName: 'Ms. Cruz', subjectName: 'English', image: null },
    { id: '3', teacherName: 'Dr. Ramirez', subjectName: 'Science', image: null }
  ];

  const renderItem = ({ item }) => {
    // Get initials for fallback avatar
    const initials = item.teacherName
      .split(' ')
      .map(word => word[0])
      .join('');

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          navigation.navigate('ChatBox', {
            teacherName: item.teacherName,
            subjectName: item.subjectName
          })
        }
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}

        <View style={styles.textContainer}>
          <Text style={styles.teacherName}>{item.teacherName}</Text>
          <Text style={styles.subjectName}>{item.subjectName}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Messages</Text>
      <FlatList data={chats} renderItem={renderItem} keyExtractor={(item) => item.id} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF0F5',
    padding: 15
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FF69B4',
    marginBottom: 15
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#FF69B4',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FF69B4',
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold'
  },
  textContainer: {
    marginLeft: 15
  },
  teacherName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FF69B4'
  },
  subjectName: {
    fontSize: 14,
    color: '#555'
  }
});

export default ChatList;
