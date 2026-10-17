import { StyleSheet, Text, View, Platform, Dimensions, FlatList } from "react-native";
import React, { useEffect, useState } from "react";
import { Streams, StudyInfo } from "@wellping/study-schemas/lib/types";
import { User } from "../helpers/secureStore/user";
import { getAllDataAsync } from "../helpers/dataUpload";
const { height, width } = Dimensions.get("screen");

type NotificationScreenProps = {
  studyInfo: StudyInfo;
  streams: Streams;
  logout: () => Promise<void>;
  navFn: ()=> void;
  userInfo: User | null;
}

type NotificationHistoryProp = {
  id: string;
  endTime: Date | null;
  startTime: Date;
  streamName: string;
  notificationTime: Date;
  tzOffset: number;
}

const NotificationScreen = (_props: NotificationScreenProps) => {
  const [notificationHistory, setNotificationHistory] = useState<Array<NotificationHistoryProp>>([]);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    getAllDataAsync().then(data => {
      if (active) setNotificationHistory(data.pings);
    }).catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, []);

  const renderItem = ({item} : {item: NotificationHistoryProp}) => {
    const endDate = item.endTime? (new Date(item.endTime)).toLocaleTimeString() : ''

    return <View style={{width: width, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', marginBottom: 20}}>
      <View style={[styles.shadow, {width: '90%', backgroundColor: '#edf2f4', borderRadius: 12, padding: 15, paddingHorizontal: 20, flexDirection: 'row'}]}>
        <View style={{flexDirection: 'column', justifyContent: 'center', width: '50%'}}>
          <Text style={{fontFamily: 'Roboto_700Bold', fontSize: 18, color: '#3a3a3a'}}>Stream ID: </Text>
          <Text style={{fontFamily: 'Roboto_400Regular', color: '#3a3a3a'}}>{item.id}</Text>
          <Text style={{fontFamily: 'Roboto_700Bold', fontSize: 18, color: '#3a3a3a'}}>Date: </Text>
          <Text style={{ alignSelf: 'auto', color: '#3a3a3a'}}>{(new Date(item.notificationTime)).toLocaleString()}</Text>
        </View>
        <View style={{flexDirection: 'column', justifyContent: 'center', width: '50%'}}>
          <Text>{(new Date(item.startTime)).toLocaleTimeString()} <Text style={{fontFamily: 'Roboto_500Medium_Italic', color: '#3a3a3a'}}>start time</Text></Text>
          <Text>{endDate} <Text style={{fontFamily: 'Roboto_500Medium_Italic', color: item.endTime? '#3a3a3a' : 'gray'}}>{item.endTime? 'end time' : 'no end time recorded'}</Text></Text>
        </View>
      </View>
    </View>
  }

  const NotificationView = () => 
  <View style={{paddingHorizontal: 0, backgroundColor: 'white', height:'100%', justifyContent: 'flex-start', alignItems: 'center', paddingTop: 0}}>
    <View style={{width: '100%', flexDirection: 'row', justifyContent: 'center'}}>
      <Text style={{ width: '90%',fontFamily: 'Roboto_700Bold', fontSize: 36, marginVertical: 20, color: '#3a3a3a'}}>
        Notifications
      </Text>
    </View>
    {notificationHistory.length==0
    ?<Text style={{ width: '90%',fontFamily: 'Roboto_400Regular', fontSize: 18, color: '#3a3a3a'}}>
        There is currently no active survey or any previously completed Ping to list. You should receive a ping soon.
    </Text>
    : <>
      <Text style={{ width: '90%',fontFamily: 'Roboto_300Light_Italic', fontSize: 18, color: '#3a3a3a', marginBottom: 10, paddingLeft: 5}}>
        Ping History
      </Text>
      <FlatList
        contentContainerStyle={[styles.center, {backgroundColor: 'white', width: width, height: height*.6, justifyContent: 'flex-start'}]}
        data={notificationHistory}
        renderItem={renderItem}
        keyExtractor={item => item.id}
      />
    </>}
  </View>

  if (historyError) return <Text>Unable to load notification history. Your saved responses have not been changed.</Text>;
  return <NotificationView />;
}

export default NotificationScreen

const styles = StyleSheet.create({
  container: {
    height: "100%", 
    alignItems: 'center', 
    justifyContent: 'flex-start',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  shadow: Platform.OS!=="ios"? {
    // Android styles
		shadowColor: 'black', 
		shadowOffset: {height: 5, width: 5}, 
		shadowRadius: 6, 
		shadowOpacity: 1, 
		elevation: 4,
	} : {
    // iOS styles
		shadowColor: 'lightgray', 
		shadowOffset: {height: 5, width: 5}, 
		shadowRadius: 3, 
		shadowOpacity: 1, 
		elevation: 5,
	},
})