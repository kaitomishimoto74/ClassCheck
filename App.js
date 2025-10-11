import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import ChatBox from './PayotChatBox/ChatBox';
import ChatList from './PayotChatBox/ChatList';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="ChatList">
        <Stack.Screen 
          name="ChatList" 
          component={ChatList} 
          options={{ title: 'Chat List' }}
        />
        <Stack.Screen 
          name="ChatBox" 
          component={ChatBox} 
          options={({ route }) => ({ title: route.params.name })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
