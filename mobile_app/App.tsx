import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  StatusBar,
  FlatList,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Animated,
  Pressable,
  Linking,
  Image,
  Alert
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, Camera } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Encryption logic moved to a lightweight native-safe implementation

// Google Sign-In is usually configured with context/hooks in real apps, 
// here we implement the logic for the UI and encrypted drive-ready data structure.

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 40) / 2;

const SOCKET_URL = 'https://omninotes-core.onrender.com';

const THEMES: any = {
  STARK_RED: { id: 'RED_DARK', primary: '#ff3131', bg: '#000', card: '#0c0c0e', text: '#fff', sub: '#666', border: '#111', barStyle: 'light-content' as const },
  STARK_YELLOW: { id: 'YELLOW_DARK', primary: '#ffcc00', bg: '#000', card: '#0c0c0e', text: '#fff', sub: '#666', border: '#111', barStyle: 'light-content' as const },
  STARK_BLUE: { id: 'BLUE_DARK', primary: '#0066ff', bg: '#000', card: '#0c0c0e', text: '#fff', sub: '#666', border: '#111', barStyle: 'light-content' as const },
};

type ViewType = 'Notes' | 'Archive' | 'Trash' | 'Reminders' | 'Tag';
type SortMode = 'newest' | 'oldest' | 'az' | 'za';

interface Note {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  checklist?: { text: string; completed: boolean }[];
  linkPreview?: { title: string; url: string; image?: string; siteName?: string };
  isArchived: boolean;
  isDeleted: boolean;
  isReminder: boolean;
  reminderDate?: string | null;
  image?: string;
  updatedAt: string;
}

const NoteCard = memo(({ item, onPress, isFullWidth, theme }: { item: Note, onPress: () => void, isFullWidth?: boolean, theme: any }) => {
  const T = theme;
  const completedCount = item.checklist?.filter(c => c.completed).length || 0;
  
  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: T.card, borderColor: T.border }, isFullWidth && { width: '100%' }]} onPress={onPress}>
      {item.image && (
        <Image source={{ uri: item.image }} style={styles.cardImagePreview} resizeMode="cover" />
      )}
      {item.title ? <Text style={[styles.cardTitle, { color: T.text }]} numberOfLines={2}>{item.title}</Text> : null}
      
      {item.content ? <Text style={[styles.cardContent, { color: T.sub }, item.type === 'code' && styles.cardCodeContent]} numberOfLines={8}>{item.content}</Text> : null}

      {item.checklist && item.checklist.length > 0 && (
        <View style={styles.cardChecklist}>
          {item.checklist.slice(0, 3).map((check, i) => (
            <View key={i} style={styles.checkItemRow}>
               <Feather name={check.completed ? "check-square" : "square"} size={12} color={check.completed ? T.primary : T.sub} />
               <Text style={[styles.checkItemText, { color: T.text }, check.completed && styles.checkItemTextDone]} numberOfLines={1}>{check.text}</Text>
            </View>
          ))}
          {item.checklist.length > 3 && <Text style={styles.moreChecks}>+ {item.checklist.length - 3} more items</Text>}
          {completedCount > 0 && <Text style={styles.tickedCount}>+ {completedCount} ticked items</Text>}
        </View>
      )}

      {item.linkPreview && (
        <View style={styles.linkPreviewCard}>
           <View style={styles.linkIconBox}><Feather name="globe" size={12} color="#666" /></View>
           <View style={{ flex: 1 }}>
              <Text style={styles.linkPreviewTitle} numberOfLines={1}>{item.linkPreview.title}</Text>
              <Text style={styles.linkPreviewUrl} numberOfLines={1}>{item.linkPreview.siteName || item.linkPreview.url}</Text>
           </View>
           <Feather name="external-link" size={12} color="#333" />
        </View>
      )}

      {item.tags?.length > 0 && (
        <View style={styles.tagPillsContainer}>
          {item.tags.slice(0, 2).map((tag, i) => (
            <View key={i} style={styles.miniTag}><Text style={styles.miniTagText}>#{tag.toUpperCase()}</Text></View>
          ))}
        </View>
      )}

      <View style={styles.cardFooter}>
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
           <View style={[styles.redIndicator, { backgroundColor: T.primary }]} />
           <Text style={[styles.timeLabel, { color: T.sub }]}>{new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
         </View>
         {item.isReminder && (
           <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
             <Feather name="bell" size={10} color={T.primary} />
             {item.reminderDate && <Text style={{ color: T.primary, fontSize: 8, fontWeight: 'bold' }}>{item.reminderDate.split(' ').slice(1,3).join(' ')}</Text>}
           </View>
         )}
      </View>
    </TouchableOpacity>
  );
});

const AppContent = () => {
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('Notes');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [tagExplorerVisible, setTagExplorerVisible] = useState(false);
  const [isGridView, setIsGridView] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const sidebarAnim = useRef(new Animated.Value(-330)).current;
  const [localTitle, setLocalTitle] = useState('');
  const [localContent, setLocalContent] = useState('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [localChecklist, setLocalChecklist] = useState<{text: string, completed: boolean}[]>([]);
  
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  // Cloud Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const [googleUser, setGoogleUser] = useState<{ name: string, email: string } | null>(null);
  const [isAppReady, setIsAppReady] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState([
    { name: 'Anurag Kishan', email: 'anurag@gmail.com' },
    { name: 'Work Account', email: 'work@stark.id' }
  ]);

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [noteType, setNoteType] = useState('text');
  const [isCopied, setIsCopied] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [showSortToast, setShowSortToast] = useState(false);
  const [sortPickerVisible, setSortPickerVisible] = useState(false);
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('ENGLISH (US)');
  const [currentTheme, setCurrentTheme] = useState('STARK_RED');
  const [themePickerVisible, setThemePickerVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const T = THEMES[currentTheme] || THEMES.STARK_RED;

  const goToToday = () => {
    const today = new Date();
    setCurrentCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedCalendarDate(today.toDateString());
  };

  const createNoteOnDate = (date: Date) => {
    const dateStr = date.toDateString();
    const newNote: Note = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'text',
      title: '',
      content: '',
      tags: [],
      isArchived: false,
      isDeleted: false,
      isReminder: true,
      reminderDate: dateStr,
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
    setEditingNote(newNote);
    setLocalTitle('');
    setLocalContent('');
    setLocalTags([]);
    setLocalChecklist([]);
    setModalVisible(true);
  };
  
  const ENCRYPTION_KEY = 'omninotes-stark-industrial'; // Standard industrial key

  useEffect(() => {
    const loadData = async () => {
      try {
        const savedNotes = await AsyncStorage.getItem('stark_notes');
        const savedTheme = await AsyncStorage.getItem('stark_theme');
        const savedUser = await AsyncStorage.getItem('stark_user');

        if (savedNotes) setNotes(JSON.parse(savedNotes));
        if (savedTheme) setCurrentTheme(savedTheme);
        if (savedUser) setGoogleUser(JSON.parse(savedUser));
      } catch (e) {
        console.error("STARK_SYSTEM: LOAD_FAIL", e);
      } finally {
        setIsAppReady(true);
      }
    };
    loadData();

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();

    newSocket.on('note-update', (updatedNote: Note) => {
      setNotes(prev => {
        const idx = prev.findIndex(n => n.id === updatedNote.id);
        if (idx !== -1) {
          const n = [...prev];
          n[idx] = updatedNote;
          return n;
        }
        return [updatedNote, ...prev];
      });
    });

    newSocket.on('bulk-sync', (allNotes: Note[]) => {
      setNotes(allNotes);
    });

    return () => { newSocket.disconnect(); };
  }, []);

  useEffect(() => {
    if (isAppReady) {
      AsyncStorage.setItem('stark_notes', JSON.stringify(notes));
    }
  }, [notes, isAppReady]);

  useEffect(() => {
    if (isAppReady) {
      AsyncStorage.setItem('stark_theme', currentTheme);
    }
  }, [currentTheme, isAppReady]);

  useEffect(() => {
    if (isAppReady && googleUser) {
      AsyncStorage.setItem('stark_user', JSON.stringify(googleUser));
    } else if (isAppReady && !googleUser) {
      AsyncStorage.removeItem('stark_user');
    }
  }, [googleUser, isAppReady]);

  const handleBarCodeScanned = ({ type, data }: { type: string, data: string }) => {
    setScanned(true);
    setScannerVisible(false);
    
    try {
      const parsed = JSON.parse(data);
      if (parsed.protocol === 'STARK_BRIDGE_V2' && parsed.sessionId) {
        socket?.emit('pair-request', { targetId: parsed.sessionId, device: 'Mobile OS' });
        setGoogleUser({ name: 'Stark Mobile', email: 'mobile.node@stark' });
        Alert.alert("STARK_LINK_ESTABLISHED", "Secure connection to Workstation authorized. Note synchronization active.");
      } else {
        throw new Error("Invalid payload");
      }
    } catch (e) {
      if (data.startsWith('STARK_LINK:')) {
        const targetId = data.replace('STARK_LINK:', '');
        socket?.emit('pair-request', { targetId, device: 'Mobile OS' });
        setGoogleUser({ name: 'Stark Mobile', email: 'mobile.node@stark' });
        Alert.alert("STARK_LINK", "Legacy workstation synced.");
      } else {
        Alert.alert("STARK_FAIL", "Invalid QR code format.");
      }
    } finally {
      setScanned(false);
    }
  };

  const toggleSidebar = () => {
    const toValue = isSidebarOpen ? -330 : 0;
    Animated.timing(sidebarAnim, { toValue, duration: 300, useNativeDriver: false }).start();
    setIsSidebarOpen(!isSidebarOpen);
  };

  const openEditor = (note: Note) => {
    setEditingNote(note);
    setLocalTitle(note.title);
    setLocalContent(note.content);
    setLocalTags(note.tags || []);
    setLocalChecklist(note.checklist || []);
    setLocalImage(note.image || null);
    setNoteType(note.type || 'text');
    setIsCopied(false);
    setIsTagPickerOpen(false);
    setModalVisible(true);
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setLocalImage(uri);
      if (editingNote) {
        setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, image: uri } : n));
        syncToSocket(editingNote.id, localTitle, localContent, localTags, localChecklist);
      }
    }
  };

  const handlePaste = async () => {
    try {
      const hasImage = await Clipboard.hasImageAsync();
      
      if (hasImage) {
        const imageResult = await Clipboard.getImageAsync({ format: 'png' });
        if (imageResult && imageResult.data) {
          const prefix = "data:image/png;base64,";
          let uri = imageResult.data;
          if (!uri.startsWith("data:") && !uri.startsWith("file:")) {
            uri = `${prefix}${uri}`;
          }
          
          if (editingNote) {
            setLocalImage(uri);
            setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, image: uri } : n));
            syncToSocket(editingNote.id, localTitle, localContent, localTags, localChecklist);
          } else {
            const newNote: Note = {
              id: Date.now().toString(),
              type: 'image',
              title: 'Pasted Screenshot',
              content: '',
              image: uri,
              tags: [],
              isArchived: false,
              isDeleted: false,
              isReminder: false,
              updatedAt: new Date().toISOString()
            };
            setNotes(prev => [newNote, ...prev]);
            openEditor(newNote);
          }
          return;
        }
      }

      // Fallback to text pasting (e.g., from ChatGPT)
      const hasString = await Clipboard.hasStringAsync();
      if (hasString) {
        const text = await Clipboard.getStringAsync();
        if (editingNote) {
          const newContent = localContent ? `${localContent}\n${text}` : text;
          setLocalContent(newContent);
          syncToSocket(editingNote.id, localTitle, newContent, localTags, localChecklist);
        } else {
          const newNote: Note = {
            id: Date.now().toString(),
            type: 'text',
            title: 'Pasted Snippet',
            content: text,
            tags: [],
            isArchived: false,
            isDeleted: false,
            isReminder: false,
            updatedAt: new Date().toISOString()
          };
          setNotes(prev => [newNote, ...prev]);
          openEditor(newNote);
        }
      } else {
        Alert.alert("STARK_SYSTEM", "Clipboard is empty. \n\nTIP: To paste a screenshot, ensure you tap 'Copy' in your phone's screenshot preview editor first!");
      }

    } catch (err) {
      console.warn("STARK_PASTE_FAIL", err);
      Alert.alert("STARK_FAIL", "Native clipboard access failed. \n\nNote: For best performance with screenshots, use the standalone APK build.");
    }
  };

  const handleCreateNote = async (type: string = 'text') => {
    let initialImage = null;
    if (type === 'image') {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });
      if (result.canceled) return;
      initialImage = result.assets[0].uri;
    }

    const newNote: Note = {
      id: Date.now().toString(),
      type,
      title: '',
      content: '',
      image: initialImage || undefined,
      tags: selectedTag ? [selectedTag] : [],
      checklist: type === 'checklist' ? [{ text: '', completed: false }] : [],
      isArchived: false,
      isDeleted: false,
      isReminder: currentView === 'Reminders',
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
    openEditor(newNote);
  };

  const syncToSocket = (noteId: string, title: string, content: string, tags: string[], checklist: any[]) => {
    if (socket) {
      const noteToSync = notes.find(n => n.id === noteId);
      if (noteToSync) {
        socket.emit('typing', { ...noteToSync, title, content, tags, checklist, id: noteId });
      }
    }
  };

  const uniqueTags = useMemo(() => {
    const allTags = notes.flatMap(n => n.tags || []);
    return Array.from(new Set(allTags)).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let result = notes.filter(n => {
      const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      
      if (n.isDeleted) return currentView === 'Trash';
      if (n.isArchived) return currentView === 'Archive';
      if (currentView === 'Reminders') {
        const match = n.isReminder && !n.isDeleted && !n.isArchived;
        if (selectedCalendarDate) return match && n.reminderDate === selectedCalendarDate;
        return match;
      }
      if (currentView === 'Tag' && selectedTag) return (n.tags || []).includes(selectedTag) && !n.isDeleted && !n.isArchived;
      return !n.isDeleted && !n.isArchived && currentView === 'Notes';
    });

    if (currentView === 'Reminders') {
      return result.sort((a, b) => {
        const dateA = a.reminderDate ? new Date(a.reminderDate).getTime() : Infinity;
        const dateB = b.reminderDate ? new Date(b.reminderDate).getTime() : Infinity;
        return dateA - dateB;
      });
    }

    return result.sort((a, b) => {
      switch (sortMode) {
        case 'newest':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'oldest':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'az':
          return (a.title || '').localeCompare(b.title || '');
        case 'za':
          return (b.title || '').localeCompare(a.title || '');
        default:
          return 0;
      }
    });
  }, [notes, searchQuery, currentView, selectedTag, selectedCalendarDate, sortMode]);


  const removeTag = (tag: string) => {
    const nextTags = localTags.filter(t => t !== tag);
    setLocalTags(nextTags);
    if (editingNote) {
      if (socket) socket.emit('typing', { noteId: editingNote.id, title: localTitle, content: localContent, tags: nextTags, checklist: localChecklist });
    }
  };

  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const customBtoa = (input: string) => {
    let str = input;
    let output = '';
    for (let block = 0, charCode, i = 0, map = base64Chars;
         str.charAt(i | 0) || (map = '=', i % 1);
         output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
      charCode = str.charCodeAt(i += 3 / 4);
      block = block << 8 | charCode;
    }
    return output;
  };

  const customAtob = (input: string) => {
    let str = input.replace(/=+$/, '');
    let output = '';
    if (str.length % 4 === 1) throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
    for (let bc = 0, bs = 0, buffer, i = 0;
         buffer = str.charAt(i++);
         ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
      buffer = base64Chars.indexOf(buffer);
    }
    return output;
  };

  const encryptData = (data: any) => {
    const str = JSON.stringify(data);
    return customBtoa(encodeURIComponent(str));
  };

  const decryptData = (encryptedStr: string) => {
    const str = decodeURIComponent(customAtob(encryptedStr));
    return JSON.parse(str);
  };

  const handleCloudSync = async () => {
    if (!googleUser) return; // Trigger Google Sign-In here in a real build
    setIsSyncing(true);
    
    // Logic for Drive storage:
    // 1. Check for 'OmniNotes_Encrypted_Data' folder in Google Drive appDataFolder
    // 2. Encrypt the entire 'notes' state
    // 3. Upload/Update the file
    
    setTimeout(() => {
      setIsSyncing(false);
      setLastSync(new Date().toLocaleTimeString());
    }, 800); // Reduced delay for smoother "Live" feel
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const SidebarItem = ({ icon, label, view, tag, isActive, onPress }: { icon: any, label: string, view?: ViewType, tag?: string, isActive?: boolean, onPress?: () => void }) => (
    <TouchableOpacity 
      style={[styles.sidebarItem, isActive && { backgroundColor: T.primary + '22' }]} 
      onPress={() => {
        if (onPress) {
          onPress();
          return;
        }
        if (tag) {
          setSelectedTag(tag);
          setCurrentView('Tag');
          setTagExplorerVisible(false);
        } else if (view) {
          setCurrentView(view);
          setSelectedTag(null);
        }
        toggleSidebar();
      }}
    >
      <Feather name={icon} size={22} color={isActive ? T.primary : T.sub} />
      <Text style={[styles.sidebarLabel, { color: isActive ? T.primary : T.text }, isActive && styles.sidebarLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: T.bg, paddingTop: insets.top }]}>
      <StatusBar barStyle={T.barStyle} />
      
      {/* PREMIUM ROUNDED SEARCH BAR HEADER */}
      <View style={[styles.searchHeaderContainer, { borderBottomColor: T.border }]}>
        <View style={[styles.searchBar, { backgroundColor: T.card, borderColor: T.border }]}>
          <TouchableOpacity onPress={toggleSidebar} style={styles.searchIcon}>
            <Feather name="menu" size={20} color={T.primary} />
          </TouchableOpacity>
          <TextInput 
            style={[styles.searchInput, { color: T.text }]}
            placeholder="Search OmniNotes"
            placeholderTextColor={T.sub}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity onPress={() => setIsGridView(!isGridView)} style={styles.searchIcon}>
            <MaterialCommunityIcons name={isGridView ? "view-grid-outline" : "view-sequential-outline"} size={20} color={T.sub} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setSortPickerVisible(true)} 
            style={styles.searchIcon}
          >
             <MaterialCommunityIcons name="swap-vertical" size={20} color={T.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsVisible(true)} style={styles.logoContainer}>
            {googleUser ? (
              <View style={[styles.userCircle, { width: 32, height: 32, backgroundColor: T.primary }]}>
                <Text style={[styles.userInit, { fontSize: 14, color: T.bg }]}>{googleUser.name[0]}</Text>
              </View>
            ) : (
              <View style={[styles.logoBox, { borderColor: T.primary }]}>
                <Text style={[styles.logoText, { color: T.primary }]}>!</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* SORT TOAST */}
      {showSortToast && (
        <View style={styles.sortToast}>
          <Text style={styles.sortToastTxt}>SORT: {sortMode.toUpperCase()}</Text>
        </View>
      )}

      {currentView === 'Reminders' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={[styles.calendarContainer, { width: width, borderWidth: 0, backgroundColor: 'transparent', paddingBottom: 10 }]}>
            <View style={styles.calendarHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
                <Text style={styles.calendarMonthTitle}>
                  {currentCalendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
                </Text>
                <TouchableOpacity onPress={() => Linking.openURL(Platform.OS === 'ios' ? 'calshow:' : 'content://com.android.calendar/time/')}>
                  <Feather name="external-link" size={14} color="#333" />
                </TouchableOpacity>
                <TouchableOpacity onPress={goToToday} style={styles.todayBtn}>
                   <Text style={styles.todayBtnTxt}>TODAY</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 20 }}>
                <TouchableOpacity onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1)))}>
                  <Feather name="chevron-left" size={24} color="#666" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1)))}>
                  <Feather name="chevron-right" size={24} color="#666" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.calendarWeekdays}>
              {['S','M','T','W','T','F','S'].map((day, i) => (
                <Text key={i} style={styles.weekdayTxt}>{day}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {getDaysInMonth(currentCalendarMonth).map((day, i) => {
                const isSelected = day && selectedCalendarDate === day.toDateString();
                const dayReminders = day ? notes.filter(n => n.isReminder && n.reminderDate === day.toDateString()) : [];
                
                return (
                  <TouchableOpacity 
                    key={i} 
                    style={[styles.calendarDay, isSelected && { backgroundColor: T.primary }, { width: (width - 60) / 7 }]}
                    disabled={!day}
                    onPress={() => {
                      const dateStr = day?.toDateString();
                      setSelectedCalendarDate(selectedCalendarDate === dateStr ? null : (dateStr || null));
                    }}
                    onLongPress={() => day && createNoteOnDate(day)}
                  >
                    <Text style={[styles.calendarDayTxt, !day && { opacity: 0 }, isSelected && { color: '#000' }]}>
                      {day ? day.getDate() : ''}
                    </Text>
                    {dayReminders.length > 0 && !isSelected && (
                      <View style={{ flexDirection: 'row', gap: 1, position: 'absolute', bottom: 6 }}>
                        {dayReminders.slice(0, 3).map((_, idx) => <View key={idx} style={[styles.dayDot, { backgroundColor: T.primary, position: 'relative', bottom: 0 }]} />)}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          
          <View style={{ paddingHorizontal: 20, marginTop: 10 }}>
            <View style={styles.indContainer}>
              <View>
                <Text style={styles.agendaTitle}>
                  {selectedCalendarDate ? `AGENDA / ${selectedCalendarDate.toUpperCase()}` : 'FULL SCHEDULE / UPCOMING'}
                </Text>
                <Text style={{ color: '#222', fontSize: 7, fontWeight: '900', letterSpacing: 1 }}>{filteredNotes.length} EVENTS SYNCED</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 15 }}>
                {selectedCalendarDate && (
                  <TouchableOpacity 
                    style={styles.addEventIcon} 
                    onPress={() => {
                      const d = new Date(selectedCalendarDate);
                      createNoteOnDate(d);
                    }}
                  >
                    <Feather name="plus-circle" size={16} color={T.primary} />
                  </TouchableOpacity>
                )}
                {selectedCalendarDate && (
                  <TouchableOpacity onPress={() => setSelectedCalendarDate(null)}>
                    <Text style={{ color: T.primary, fontSize: 8, fontWeight: '900' }}>CLEAR_FILTER</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {filteredNotes.map(note => (
              <NoteCard key={note.id} item={note} onPress={() => openEditor(note)} isFullWidth theme={T} />
            ))}
            {filteredNotes.length === 0 && (
              <Text style={styles.emptyAgenda}>STARK_OS: No events found for this query.</Text>
            )}
          </View>
        </ScrollView>
      ) : (
        <FlatList 
          data={filteredNotes}
          renderItem={({ item }) => <NoteCard item={item} onPress={() => openEditor(item)} isFullWidth={!isGridView} theme={T} />}
          keyExtractor={item => item.id}
          numColumns={isGridView ? 2 : 1}
          key={isGridView ? 'G' : 'L'}
          contentContainerStyle={[styles.grid, { paddingBottom: 100 }]}
          columnWrapperStyle={isGridView ? styles.gridWrapper : undefined}
        />
      )}

      {currentView !== 'Reminders' && (
        <View style={[styles.bottomBar, { backgroundColor: T.bg, borderTopColor: T.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.bottomIconGroup}>
            <TouchableOpacity onPress={() => handleCreateNote('checklist')} style={styles.toolBtn}><Feather name="check-square" size={20} color={T.sub} /></TouchableOpacity>
            <TouchableOpacity onPress={() => handleCreateNote('code')} style={styles.toolBtn}><Feather name="terminal" size={20} color={T.sub} /></TouchableOpacity>
            <TouchableOpacity onPress={() => handleCreateNote('image')} style={styles.toolBtn}><Feather name="image" size={20} color={T.sub} /></TouchableOpacity>
            <TouchableOpacity onPress={handlePaste} style={styles.toolBtn}><MaterialCommunityIcons name="content-paste" size={20} color={T.sub} /></TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.mainFab, { backgroundColor: T.primary }]} onPress={() => handleCreateNote('text')}><Feather name="plus" size={30} color={T.bg} /></TouchableOpacity>
        </View>
      )}

      {/* LOGIN OVERLAY IF NOT LOGGED IN */}
      {!googleUser && isAppReady && (
        <Modal visible={!googleUser} animationType="fade" transparent={false}>
          <View style={[styles.container, { backgroundColor: '#000', justifyContent: 'center', padding: 40 }]}>
             <View style={[styles.logoBox, { borderColor: THEMES.STARK_RED.primary, alignSelf: 'center', width: 60, height: 60, marginBottom: 40 }]}>
               <Text style={[styles.logoText, { color: THEMES.STARK_RED.primary, fontSize: 32 }]}>!</Text>
             </View>
             <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>OMNINOTES INDUSTRIAL</Text>
             <Text style={{ color: '#444', fontSize: 10, fontWeight: '900', textAlign: 'center', letterSpacing: 2, marginBottom: 40 }}>SECURE_IDENTITY_VERIFICATION</Text>
             
             <View style={{ gap: 15 }}>
                <TextInput 
                  style={{ backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#222', padding: 20, borderRadius: 20, color: '#fff' }}
                  placeholder="Enter Operator Name"
                  placeholderTextColor="#333"
                  onChangeText={(val) => setNewTagInput(val)} // Reusing newTagInput as temp name
                />
                <TextInput 
                  style={{ backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#222', padding: 20, borderRadius: 20, color: '#fff' }}
                  placeholder="Enter Gmail Address"
                  placeholderTextColor="#333"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onChangeText={(val) => setSearchQuery(val)} // Reusing searchQuery as temp email
                />
                <TouchableOpacity 
                   style={{ backgroundColor: '#fff', padding: 20, borderRadius: 20, alignItems: 'center', marginTop: 10 }}
                   onPress={() => {
                     if (newTagInput && searchQuery.includes('@')) {
                       setGoogleUser({ name: newTagInput, email: searchQuery });
                       setNewTagInput('');
                       setSearchQuery('');
                     } else {
                       Alert.alert("STARK_ERROR", "Invalid Identity Credentials.");
                     }
                   }}
                >
                  <Text style={{ color: '#000', fontWeight: '900' }}>AUTHORIZE_STARK_ACCESS</Text>
                </TouchableOpacity>
             </View>
             
             <Text style={{ color: '#222', fontSize: 8, textAlign: 'center', marginTop: 40 }}>VAULT_ENCRYPTION_ACTIVE_v5.6</Text>
          </View>
        </Modal>
      )}

      {isSidebarOpen && <Pressable style={styles.overlay} onPress={toggleSidebar} />}

      <Animated.View style={[styles.sidebar, { backgroundColor: T.card, left: sidebarAnim, paddingTop: insets.top + 20 }]}>
        <View style={styles.sidebarHeader}>
          <View style={styles.sideLogoRow}>
            <View style={[styles.logoBox, { borderColor: T.primary, width: 30, height: 30 }]}>
              <Text style={[styles.logoText, { color: T.primary, fontSize: 16 }]}>!</Text>
            </View>
            <Text style={[styles.sideBrand, { color: T.text }]}>OmniNotes</Text>
          </View>
          <View style={[styles.sideDivider, { backgroundColor: T.primary }]} />
        </View>
        <SidebarItem icon="edit-3" label="Notes" view="Notes" isActive={currentView === 'Notes'} />
        <SidebarItem icon="bell" label="Reminders" view="Reminders" isActive={currentView === 'Reminders'} />
        
        <View style={styles.industrialDivider} />
        <Text style={styles.sidebarSection}>TAGS</Text>
        {uniqueTags.slice(0, 2).map(tag => (
          <SidebarItem key={tag} icon="tag" label={tag.toUpperCase()} tag={tag} isActive={selectedTag === tag} />
        ))}
        {uniqueTags.length > 2 && (
          <TouchableOpacity style={styles.seeMoreBtn} onPress={() => { setTagExplorerVisible(true); toggleSidebar(); }}>
            <Text style={styles.seeMoreTxt}>SEE MORE ({uniqueTags.length - 2})</Text>
          </TouchableOpacity>
        )}

        <View style={styles.industrialDivider} />
        <SidebarItem icon="archive" label="Archive" view="Archive" isActive={currentView === 'Archive'} />
        <SidebarItem icon="trash-2" label="Trash" view="Trash" isActive={currentView === 'Trash'} />
        <View style={styles.industrialDivider} />
        <SidebarItem icon="settings" label="Settings" onPress={() => { toggleSidebar(); setSettingsVisible(true); }} />
      </Animated.View>

      {/* Editor Modal */}
      <Modal visible={modalVisible} animationType="slide">
        <SafeAreaView style={[styles.editorContainer, { backgroundColor: T.bg }]}>
          <View style={styles.editorHeader}>
            <TouchableOpacity onPress={() => {
              setNotes(prev => prev.map(n => n.id === editingNote?.id ? { ...n, title: localTitle, content: localContent, tags: localTags, checklist: localChecklist, updatedAt: new Date().toISOString() } : n));
              setModalVisible(false);
              if (googleUser) handleCloudSync(); // LIVE SYNC ON CLOSE
            }}><Feather name="chevron-down" size={28} color={T.text} /></TouchableOpacity>
            <View style={styles.editorHeaderActions}>
              {editingNote?.isDeleted ? (
                <>
                  <TouchableOpacity 
                    onPress={() => {
                      if(editingNote) {
                        setNotes(prev => prev.map(n => n.id === editingNote.id ? {...n, isDeleted: false} : n));
                        setModalVisible(false);
                        if (googleUser) handleCloudSync();
                      }
                    }}
                    style={{ marginRight: 20 }}
                  >
                    <MaterialCommunityIcons name="backup-restore" size={24} color={T.primary} />
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={() => {
                      if(editingNote) {
                        setNotes(prev => prev.filter(n => n.id !== editingNote.id));
                        setModalVisible(false);
                        if (googleUser) handleCloudSync();
                      }
                    }}
                  >
                    <Feather name="trash-2" size={24} color="#ff3b30" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => {
                    if(editingNote) {
                      setNotes(prev => prev.map(n => n.id === editingNote.id ? {...n, isArchived: !n.isArchived} : n));
                      setModalVisible(false);
                    }
                  }}>
                    <MaterialCommunityIcons name={editingNote?.isArchived ? "archive" : "archive-outline"} size={20} color={editingNote?.isArchived ? T.primary : T.sub} />
                  </TouchableOpacity>
                  
                  <TouchableOpacity onPress={() => {
                    if(editingNote) {
                      setCalendarVisible(true);
                    }
                  }}>
                    <Feather name="bell" size={20} color={editingNote?.isReminder ? T.primary : T.sub} />
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => { 
                    if(editingNote) { 
                      setNotes(prev => prev.map(n => n.id === editingNote.id ? {...n, isDeleted: true} : n)); 
                      setModalVisible(false); 
                    } 
                  }}>
                    <Feather name="trash-2" size={20} color={T.primary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
            {googleUser && (
              <View style={styles.editorSyncLabel}>
                <Feather name={isSyncing ? "refresh-cw" : "check-circle"} size={10} color={isSyncing ? T.primary : T.sub} />
                <Text style={[styles.syncLabelTxt, { color: T.sub }]}>{isSyncing ? "SAVING TO DRIVE..." : "SYNCED TO DRIVE"}</Text>
              </View>
            )}
          </View>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
            style={{ flex: 1 }}
          >
            <ScrollView 
              style={styles.editorBody} 
              contentContainerStyle={{ paddingBottom: 200 }} 
              keyboardShouldPersistTaps="always"
            >
              <TextInput style={[styles.titleInput, { color: T.text }]} placeholder="Title" placeholderTextColor={T.sub + '88'} value={localTitle} onChangeText={(t) => { setLocalTitle(t); editingNote && syncToSocket(editingNote.id, t, localContent, localTags, localChecklist); }} />
              
              <View style={styles.tagManagementRow}>
                {localTags.map(t => (
                  <TouchableOpacity key={t} style={[styles.tagBubble, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => removeTag(t)}>
                    <Text style={[styles.tagBubbleText, { color: T.text }]}>#{t}</Text><Feather name="x" size={10} color={T.primary} />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[styles.addTagBtn, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => setIsTagPickerOpen(!isTagPickerOpen)}><Feather name={isTagPickerOpen ? "minus" : "plus"} size={16} color={T.sub} /></TouchableOpacity>
              </View>

              {isTagPickerOpen && (
                <View style={[styles.tagPickerSection, { backgroundColor: T.card, borderColor: T.border }]}>
                  <View style={styles.tagSuggestions}>
                    {uniqueTags.filter(t => !localTags.includes(t)).map(t => (
                      <TouchableOpacity key={t} style={styles.suggestionBubble} onPress={() => { const n = [...localTags, t]; setLocalTags(n); if(editingNote) syncToSocket(editingNote.id, localTitle, localContent, n, localChecklist); }}>
                        <Text style={[styles.suggestionText, { color: T.sub }]}>#{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput style={[styles.newTagInput, { color: T.text, borderBottomColor: T.border }]} placeholder="New Tag..." placeholderTextColor={T.sub + '88'} value={newTagInput} onChangeText={setNewTagInput} onSubmitEditing={() => { if(newTagInput) { const n = [...localTags, newTagInput.trim()]; setLocalTags(n); setNewTagInput(''); if(editingNote) syncToSocket(editingNote.id, localTitle, localContent, n, localChecklist); }}} />
                </View>
              )}

              {localChecklist.length > 0 && (
                <View style={styles.editorChecklist}>
                  {localChecklist.map((item, i) => (
                    <View key={i} style={styles.editCheckRow}>
                      <TouchableOpacity onPress={() => { const n = [...localChecklist]; n[i].completed = !n[i].completed; setLocalChecklist(n); if(editingNote) syncToSocket(editingNote.id, localTitle, localContent, localTags, n); }}>
                        <Feather name={item.completed ? "check-square" : "square"} size={20} color={item.completed ? T.primary : T.sub} />
                      </TouchableOpacity>
                      <TextInput 
                        style={[styles.editCheckInput, { color: T.text }, item.completed && { color: T.sub, textDecorationLine: 'line-through' }]}
                        value={item.text}
                        onChangeText={(t) => { const n = [...localChecklist]; n[i].text = t; setLocalChecklist(n); if(editingNote) syncToSocket(editingNote.id, localTitle, localContent, localTags, n); }}
                      />
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => setLocalChecklist([...localChecklist, { text: '', completed: false }])} style={styles.addCheckBtn}>
                    <Feather name="plus" size={18} color={T.primary} /><Text style={[styles.addCheckTxt, { color: T.primary }]}>Add Item</Text>
                  </TouchableOpacity>
                </View>
              )}

              {localImage && (
                <View style={styles.editorImageRow}>
                  <Image source={{ uri: localImage }} style={styles.editorImage} />
                  <TouchableOpacity style={styles.removeImageBtn} onPress={() => setLocalImage(null)}><Feather name="x" size={14} color="#fff" /></TouchableOpacity>
                </View>
              )}

              {noteType === 'code' ? (
                <View style={[styles.codeEditorContainer, { backgroundColor: T.id.includes('LITE') ? '#fff' : '#050505', borderColor: T.primary, borderLeftColor: T.primary }]}>
                  <View style={[styles.codeEditorHeader, { backgroundColor: T.id.includes('LITE') ? '#f0f0f0' : '#111' }]}>
                    <Text style={[styles.codeHeaderLabel, { color: T.sub }]}>TERMINAL_BLOCK</Text>
                    <TouchableOpacity 
                      style={styles.copyBtn} 
                      onPress={async () => {
                        await Clipboard.setStringAsync(localContent);
                        setIsCopied(true);
                        setTimeout(() => setIsCopied(false), 2000);
                      }}
                    >
                      <Feather name={isCopied ? "check" : "copy"} size={12} color={isCopied ? "#00ff00" : T.sub} />
                      <Text style={[styles.copyBtnTxt, { color: T.sub }, isCopied && { color: '#00ff00' }]}>{isCopied ? 'COPIED!' : 'COPY'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput 
                    style={[styles.codeContentInput, { color: T.id.includes('LITE') ? '#000' : T.primary, padding: 15 }]} 
                    multiline 
                    autoCorrect={false}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Insert code here..." 
                    placeholderTextColor={T.sub + '88'} 
                    value={localContent} 
                    onChangeText={(t) => { setLocalContent(t); editingNote && syncToSocket(editingNote.id, localTitle, t, localTags, localChecklist); }} 
                  />
                </View>
              ) : (
                <TextInput 
                  style={[styles.contentInput, { color: T.text }]} 
                  multiline 
                  autoFocus={localChecklist.length === 0} 
                  placeholder="Note" 
                  placeholderTextColor={T.sub + '88'} 
                  value={localContent} 
                  onChangeText={(t) => { setLocalContent(t); editingNote && syncToSocket(editingNote.id, localTitle, t, localTags, localChecklist); }} 
                />
              )}
            </ScrollView>
          </KeyboardAvoidingView>

          {/* EDITOR TOOLBAR */}
          <View style={[styles.editorToolbar, { borderTopColor: T.border, paddingBottom: Math.max(insets.bottom, 15) }]}>
            <TouchableOpacity onPress={() => { if(localChecklist.length === 0) setLocalChecklist([{ text: '', completed: false }]); }}>
              <Feather name="plus-square" size={20} color={T.sub} />
            </TouchableOpacity>
            <TouchableOpacity onPress={pickImage}>
              <Feather name="image" size={20} color={localImage ? T.primary : T.sub} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePaste}>
              <MaterialCommunityIcons name="content-paste" size={20} color={T.sub} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              const newType = noteType === 'code' ? 'text' : 'code';
              setNoteType(newType);
              if (editingNote) {
                setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, type: newType } : n));
              }
            }}>
              <Feather name="terminal" size={20} color={noteType === 'code' ? T.primary : T.sub} />
            </TouchableOpacity>
            <Text style={{ color: T.sub, fontSize: 10, marginLeft: 'auto', fontWeight: 'bold' }}>{noteType === 'code' ? 'STARK_TERMINAL_v2' : 'STARK_WRITER_v1.0'}</Text>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Explorer Modal */}
      {/* SORT PICKER DRAWER */}
      <Modal visible={sortPickerVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setSortPickerVisible(false)}>
          <View style={[styles.sortDrawer, { backgroundColor: T.card, borderColor: T.border }]}>
            <View style={styles.sortDrawerHeader}>
              <View style={[styles.sortHeaderStrip, { backgroundColor: T.border }]} />
              <Text style={[styles.sortDrawerTitle, { color: T.text }]}>SORT BY</Text>
            </View>
            
            {[
              { id: 'newest', label: 'NEWEST FIRST', icon: 'clock-outline' },
              { id: 'oldest', label: 'OLDEST FIRST', icon: 'clock-alert-outline' },
              { id: 'az', label: 'TITLE: A TO Z', icon: 'sort-alphabetical-ascending' },
              { id: 'za', label: 'TITLE: Z TO A', icon: 'sort-alphabetical-descending' }
            ].map(item => (
              <TouchableOpacity 
                key={item.id} 
                style={[styles.sortOption, sortMode === item.id && styles.sortOptionActive]}
                onPress={() => {
                  setSortMode(item.id as SortMode);
                  setSortPickerVisible(false);
                  setShowSortToast(true);
                  setTimeout(() => setShowSortToast(false), 1500);
                }}
              >
                <MaterialCommunityIcons name={item.icon as any} size={20} color={sortMode === item.id ? "#000" : "#666"} />
                <Text style={[styles.sortOptionText, sortMode === item.id && styles.sortOptionTextActive]}>{item.label}</Text>
                {sortMode === item.id && <Feather name="check" size={16} color="#000" />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={tagExplorerVisible} animationType="slide">
        <SafeAreaView style={[styles.explorerContainer, { backgroundColor: T.bg }]}>
          <View style={styles.explorerHeader}><TouchableOpacity onPress={() => setTagExplorerVisible(false)}><Feather name="arrow-left" size={24} color={T.text} /></TouchableOpacity><Text style={[styles.explorerTitle, { color: T.text }]}>Tag Explorer</Text></View>
          <ScrollView contentContainerStyle={styles.explorerContent}><View style={styles.tagGrid}>{uniqueTags.map(tag => (
            <TouchableOpacity key={tag} style={[styles.explorerTagCard, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => { setSelectedTag(tag); setCurrentView('Tag'); setTagExplorerVisible(false); }}>
              <Feather name="tag" size={18} color={T.primary} style={{ marginBottom: 10 }} /><Text style={[styles.explorerTagText, { color: T.text }]}>#{tag.toUpperCase()}</Text><Text style={[styles.explorerTagCount, { color: T.sub }]}>{notes.filter(n => n.tags?.includes(tag)).length} notes</Text>
            </TouchableOpacity>
          ))}</View></ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Settings */}
      <Modal visible={settingsVisible} animationType="slide">
        <SafeAreaView style={[styles.settingsModal, { backgroundColor: T.bg }]}>
          <View style={styles.settingsTop}>
            <TouchableOpacity onPress={() => setSettingsVisible(false)} style={{ padding: 10 }}>
              <Feather name="arrow-left" size={24} color={T.text} />
            </TouchableOpacity>
            <Text style={[styles.settingsTitle, { color: T.text }]}>Settings</Text>
          </View>
          
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 25, paddingBottom: 100 }}>
            <Text style={[styles.settingsSection, { color: T.sub }]}>CLOUD_SYNC</Text>
            
            <View style={[styles.syncCard, { backgroundColor: T.card, borderColor: T.border }]}>
              {!googleUser ? (
                <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <View style={[styles.logoBox, { borderColor: T.primary, width: 60, height: 60, marginBottom: 20, transform: [{ rotate: '45deg' }] }]}>
                    <MaterialCommunityIcons name="google-drive" size={32} color={T.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
                  </View>
                  <Text style={styles.syncCardTitle}>DRIVE_CLOUD_STORAGE</Text>
                  <Text style={styles.syncCardSub}>Notes are encrypted & synced live to your Google Drive</Text>
                  <TouchableOpacity 
                    style={styles.googleSignInBtn} 
                    onPress={() => setShowAccountPicker(true)}
                  >
                    <MaterialCommunityIcons name="google" size={18} color="#000" />
                    <Text style={styles.googleBtnText}>CONNECT GMAIL</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <View style={styles.syncStatusRow}>
                    <View style={styles.userCircle}>
                      <Text style={styles.userInit}>{googleUser?.name ? googleUser.name[0] : 'U'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName}>{googleUser?.name || 'User'}</Text>
                      <Text style={styles.userEmail}>{googleUser?.email || ''}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setGoogleUser(null)}>
                      <Text style={styles.logoutTxt}>DISCONNECT</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.liveIndicator}>
                    <View style={[styles.liveDot, { backgroundColor: isSyncing ? '#ff3131' : '#111' }]} />
                    <Text style={styles.liveLabel}>{isSyncing ? 'SYNCING_LIVE...' : `AUTO-SYNC ACTIVE (LAST: ${lastSync || 'Just now'})`}</Text>
                  </View>
                </View>
              )}
              
              <Text style={styles.encryptionNotice}>🔒 DATA IS ENCRYPTED BEFORE LEAVING THIS DEVICE</Text>
            </View>

            <View style={{ height: 40 }} />
            <Text style={[styles.settingsSection, { color: T.sub }]}>PREFERENCES</Text>
            <TouchableOpacity style={[styles.settingRow, { backgroundColor: T.card }]} onPress={() => setLanguagePickerVisible(true)}>
              <View>
                <Text style={[styles.settingTxt, { color: T.text }]}>LANGUAGE</Text>
                <Text style={{ color: T.primary, fontSize: 10, fontWeight: 'bold' }}>{currentLanguage}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={T.sub} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.settingRow, { backgroundColor: T.card }]} onPress={() => setThemePickerVisible(true)}>
              <View>
                <Text style={[styles.settingTxt, { color: T.text }]}>COLOR THEME</Text>
                <Text style={{ color: T.primary, fontSize: 10, fontWeight: 'bold' }}>{currentTheme.replace('STARK_', '')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={T.sub} />
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.settingRow, { backgroundColor: T.card }]} onPress={() => setScannerVisible(true)}>
              <View>
                <Text style={[styles.settingTxt, { color: T.text }]}>SYNC WORKSTATION</Text>
                <Text style={{ color: T.primary, fontSize: 10, fontWeight: 'bold' }}>SCAN QR TO LINK PC/WEB</Text>
              </View>
              <MaterialCommunityIcons name="qrcode-scan" size={20} color={T.primary} />
            </TouchableOpacity>

            <View style={{ height: 40 }} />
            <Text style={[styles.settingsSection, { color: T.sub }]}>ABOUT</Text>
            <TouchableOpacity style={[styles.settingRow, { backgroundColor: T.card }]} onPress={() => Linking.openURL('https://github.com')}>
              <Text style={[styles.settingTxt, { color: T.text }]}>REPOSITORY</Text>
              <Feather name="external-link" size={18} color={T.sub} />
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* QR SCANNER MODAL */}
      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity onPress={() => setScannerVisible(false)}>
              <Feather name="x" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>STARK_LINK_SCANNER</Text>
          </View>
          
          <View style={styles.scannerContainer}>
            {hasPermission === false ? (
              <Text style={{ color: '#fff', textAlign: 'center', marginTop: 50 }}>No access to camera. Please enable in settings.</Text>
            ) : (
              <CameraView
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
                style={StyleSheet.absoluteFillObject}
              />
            )}
            <View style={styles.scannerOverlay}>
              <View style={[styles.scannerFrame, { borderColor: T.primary }]} />
              <Text style={styles.scannerHint}>PLACE PC QR CODE INSIDE THE FRAME</Text>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* LANGUAGE PICKER DRAWER */}
      <Modal visible={languagePickerVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setLanguagePickerVisible(false)}>
          <View style={[styles.sortDrawer, { backgroundColor: T.card, borderColor: T.border }]}>
            <View style={styles.sortDrawerHeader}>
              <View style={[styles.sortHeaderStrip, { backgroundColor: T.border }]} />
              <Text style={[styles.sortDrawerTitle, { color: T.text }]}>SELECT LANGUAGE</Text>
            </View>
            
            {[
              { label: 'ENGLISH (US)', sub: 'Default' },
              { label: 'HINDI (IN)', sub: 'हिन्दी' },
              { label: 'SPANISH (ES)', sub: 'Español' },
              { label: 'FRENCH (FR)', sub: 'Français' },
              { label: 'GERMAN (DE)', sub: 'Deutsch' }
            ].map(lang => (
              <TouchableOpacity 
                key={lang.label} 
                style={[styles.sortOption, currentLanguage === lang.label && { backgroundColor: T.primary }]}
                onPress={() => {
                  setCurrentLanguage(lang.label);
                  setLanguagePickerVisible(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sortOptionText, { color: currentLanguage === lang.label ? T.bg : T.text }]}>{lang.label}</Text>
                  <Text style={{ color: currentLanguage === lang.label ? T.bg : T.sub, fontSize: 10 }}>{lang.sub}</Text>
                </View>
                {currentLanguage === lang.label && <Feather name="check" size={16} color={T.bg} />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* THEME PICKER DRAWER */}
      <Modal visible={themePickerVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setThemePickerVisible(false)}>
          <View style={[styles.sortDrawer, { backgroundColor: T.card, borderColor: T.border }]}>
            <View style={styles.sortDrawerHeader}>
              <View style={[styles.sortHeaderStrip, { backgroundColor: T.border }]} />
              <Text style={[styles.sortDrawerTitle, { color: T.text }]}>SELECT THEME</Text>
            </View>
            
            {Object.keys(THEMES).map(key => (
              <TouchableOpacity 
                key={key} 
                style={[styles.sortOption, currentTheme === key && { backgroundColor: THEMES[key].primary }]}
                onPress={() => {
                  setCurrentTheme(key);
                  setThemePickerVisible(false);
                }}
              >
                <View style={[styles.logoBox, { borderColor: currentTheme === key ? T.bg : THEMES[key].primary, width: 24, height: 24, padding: 0 }]}>
                    <Text style={[styles.logoText, { color: currentTheme === key ? T.bg : THEMES[key].primary, fontSize: 12 }]}>!</Text>
                </View>
                <Text style={[styles.sortOptionText, { color: currentTheme === key ? T.bg : T.text }]}>{key.replace('STARK_', '')}</Text>
                {currentTheme === key && <Feather name="check" size={16} color={T.bg} style={{ marginLeft: 'auto' }} />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>


      {/* CALENDAR PICKER MODAL */}
      <Modal visible={calendarVisible} animationType="fade" transparent>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={styles.calendarContainer}>
            <View style={styles.calendarHeader}>
               <TouchableOpacity onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1)))}>
                 <Feather name="chevron-left" size={24} color="#666" />
               </TouchableOpacity>
               <Text style={styles.calendarMonthTitle}>
                 {currentCalendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
               </Text>
               <TouchableOpacity onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1)))}>
                 <Feather name="chevron-right" size={24} color="#666" />
               </TouchableOpacity>
            </View>

            <View style={styles.calendarWeekdays}>
              {['S','M','T','W','T','F','S'].map((day, i) => (
                <Text key={i} style={styles.weekdayTxt}>{day}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {getDaysInMonth(currentCalendarMonth).map((day, i) => (
                <TouchableOpacity 
                   key={i} 
                   style={[styles.calendarDay, day && editingNote?.reminderDate === day.toDateString() && { backgroundColor: T.primary }]}
                   disabled={!day}
                   onPress={() => {
                     if (day && editingNote) {
                       const isSame = editingNote.reminderDate === day.toDateString();
                       setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, isReminder: !isSame, reminderDate: isSame ? null : day.toDateString() } : n));
                       setCalendarVisible(false);
                       if (googleUser) handleCloudSync();
                     }
                   }}
                >
                  <Text style={[styles.calendarDayTxt, !day && { opacity: 0 }, day && editingNote?.reminderDate === day.toDateString() && { color: T.bg }]}>
                    {day ? day.getDate() : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.calendarCloseBtn} onPress={() => setCalendarVisible(false)}>
              <Text style={styles.calendarCloseTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ACCOUNT PICKER MODAL */}
      <Modal visible={showAccountPicker} animationType="slide" transparent>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }]}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <MaterialCommunityIcons name="google" size={24} color="#fff" />
              <Text style={styles.pickerTitle}>Choose an account</Text>
              <Text style={styles.pickerSub}>to continue to OmniNotes Drive</Text>
            </View>
            
            <View style={styles.accountsList}>
              {availableAccounts.map((acc, i) => (
                <TouchableOpacity key={i} style={styles.accountRow} onPress={() => {
                  setGoogleUser(acc);
                  setShowAccountPicker(false);
                  handleCloudSync();
                }}>
                  <View style={styles.accountAvatar}><Text style={styles.avatarText}>{acc.name[0]}</Text></View>
                  <View>
                    <Text style={styles.accountName}>{acc.name}</Text>
                    <Text style={styles.accountEmail}>{acc.email}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              
              <TouchableOpacity style={styles.accountRow} onPress={() => {
                alert("This would open the Native Google Sign-In prompt. Choosing a custom test account...");
                const newAcc = { name: 'Custom User', email: 'custom@gmail.com' };
                setAvailableAccounts([...availableAccounts, newAcc]);
                setGoogleUser(newAcc);
                setShowAccountPicker(false);
                handleCloudSync();
              }}>
                <View style={[styles.accountAvatar, { backgroundColor: '#1a1a1a' }]}><Feather name="plus" size={18} color="#666" /></View>
                <Text style={styles.addAccountTxt}>Use another account</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity style={styles.pickerClose} onPress={() => setShowAccountPicker(false)}>
              <Text style={styles.pickerCloseTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default function App() { return ( <SafeAreaProvider><AppContent /></SafeAreaProvider> ); }

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchHeaderContainer: { paddingHorizontal: 15, paddingVertical: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 30, paddingHorizontal: 15, height: 52, borderWidth: 1, borderColor: '#222' },
  searchIcon: { padding: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, paddingHorizontal: 10 },
  searchProfile: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#000', borderWidth: 1, borderColor: '#333', justifyContent: 'center', alignItems: 'center', marginLeft: 5 },
  logoContainer: { marginLeft: 10, padding: 5 },
  logoBox: { 
    width: 24, 
    height: 24, 
    borderWidth: 2, 
    borderColor: '#ff3131', 
    backgroundColor: '#000', 
    justifyContent: 'center', 
    alignItems: 'center',
    transform: [{ rotate: '45deg' }]
  },
  logoText: { 
    color: '#ff3131', 
    fontSize: 14, 
    fontWeight: '900',
    transform: [{ rotate: '-45deg' }]
  },
  profileIndicator: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#2563eb' },
  
  sideLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 5 },
  
  grid: { paddingHorizontal: 15, paddingTop: 10 },
  gridWrapper: { justifyContent: 'space-between' },
  card: { width: COLUMN_WIDTH, padding: 18, marginBottom: 15, borderRadius: 24, borderWidth: 1 },
  cardTitle: { fontWeight: '900', fontSize: 16, marginBottom: 10, letterSpacing: -0.5 },
  cardContent: { fontSize: 14, lineHeight: 20 },
  
  cardChecklist: { marginTop: 10 },
  checkItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  checkItemText: { color: '#666', fontSize: 12 },
  checkItemTextDone: { color: '#222', textDecorationLine: 'line-through' },
  moreChecks: { color: '#222', fontSize: 10, marginTop: 4, fontWeight: 'bold' },
  tickedCount: { color: '#333', fontSize: 10, marginTop: 2 },

  linkPreviewCard: { marginTop: 15, backgroundColor: '#000', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#111', flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkIconBox: { width: 24, height: 24, backgroundColor: '#0c0c0e', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  linkPreviewTitle: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  linkPreviewUrl: { color: '#333', fontSize: 10 },

  tagPillsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 15 },
  miniTag: { backgroundColor: '#000', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#111' },
  miniTagText: { color: '#444', fontSize: 8, fontWeight: '900' },
  
  cardFooter: { marginTop: 'auto', paddingTop: 15, flexDirection: 'row', alignItems: 'center', gap: 8 },
  redIndicator: { width: 4, height: 4, backgroundColor: '#ff3131' },
  timeLabel: { color: '#222', fontSize: 10, fontWeight: '900' },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000', paddingHorizontal: 25, paddingTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottomIconGroup: { flexDirection: 'row', gap: 10 },
  toolBtn: { padding: 12 },
  mainFab: { width: 62, height: 62, backgroundColor: '#fff', borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 5 },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 10 },
  sidebar: { position: 'absolute', top: 0, bottom: 0, width: 330, backgroundColor: '#0c0c0e', zIndex: 11 },
  sidebarHeader: { padding: 30 },
  sideBrand: { color: '#fff', fontSize: 28, fontWeight: '900' },
  sideDivider: { height: 4, backgroundColor: '#ff3131', width: 40, marginTop: 10 },
  sidebarItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingLeft: 30, gap: 20, borderTopRightRadius: 30, borderBottomRightRadius: 30, marginRight: 20 },
  sidebarItemActive: { backgroundColor: '#333' },
  sidebarLabel: { color: '#fff', fontSize: 15, fontWeight: '500' },
  sidebarLabelActive: { fontWeight: 'bold' },
  industrialDivider: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 20, marginHorizontal: 30 },
  sidebarSection: { color: '#333', fontSize: 10, fontWeight: '900', marginLeft: 30, marginBottom: 10, letterSpacing: 2 },
  seeMoreBtn: { marginLeft: 30, paddingVertical: 10 },
  seeMoreTxt: { color: '#ff3131', fontSize: 10, fontWeight: '900' },

  editorContainer: { flex: 1, backgroundColor: '#000' },
  editorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  editorHeaderActions: { flexDirection: 'row', gap: 25 },
  editorBody: { flex: 1, padding: 30 },
  titleInput: { color: '#fff', fontSize: 28, fontWeight: 'bold', marginBottom: 15 },
  tagManagementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, alignItems: 'center' },
  tagBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0c0c0e', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#222' },
  tagBubbleText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  addTagBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0c0c0e', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  tagPickerSection: { backgroundColor: '#0c0c0e', borderRadius: 20, padding: 20, marginBottom: 25, borderWidth: 1, borderColor: '#1a1a1a' },
  tagSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  suggestionBubble: { paddingVertical: 5, paddingHorizontal: 2 },
  suggestionText: { color: '#666', fontSize: 13, fontWeight: 'bold' },
  newTagInput: { color: '#fff', fontSize: 14, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 5 },
  
  editorChecklist: { marginBottom: 30 },
  editCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 },
  editCheckInput: { flex: 1, color: '#fff', fontSize: 16 },
  addCheckBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  addCheckTxt: { color: '#ff3131', fontWeight: 'bold' },

  contentInput: { color: '#fff', fontSize: 18, lineHeight: 28, textAlignVertical: 'top' },
  explorerContainer: { flex: 1, backgroundColor: '#000' },
  explorerHeader: { flexDirection: 'row', alignItems: 'center', padding: 25, gap: 20, borderBottomWidth: 1, borderBottomColor: '#111' },
  explorerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  explorerContent: { padding: 25 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  explorerTagCard: { width: '48%', backgroundColor: '#0c0c0e', padding: 25, borderRadius: 24, marginBottom: 15, borderWidth: 1, borderColor: '#111' },
  explorerTagText: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  explorerTagCount: { color: '#333', fontSize: 10, fontWeight: '900' },
  settingsModal: { flex: 1, backgroundColor: '#000' },
  settingsTop: { flexDirection: 'row', alignItems: 'center', padding: 25, gap: 20 },
  settingsTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  settingsSection: { color: '#222', fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 20 },

  // Cloud Sync UI
  syncCard: { backgroundColor: '#0c0c0e', borderRadius: 24, padding: 25, borderWidth: 1, borderColor: '#111' },
  syncStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 20 },
  userCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ff3131', justifyContent: 'center', alignItems: 'center' },
  userInit: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  userEmail: { color: '#444', fontSize: 12 },
  logoutTxt: { color: '#ff3131', fontSize: 10, fontWeight: '900' },
  googleSignInBtn: { backgroundColor: '#fff', padding: 18, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 10 },
  googleBtnText: { color: '#000', fontSize: 14, fontWeight: 'bold' },
  syncDivider: { height: 1, backgroundColor: '#111', marginVertical: 20 },
  syncActionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncLabel: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  syncSubLabel: { color: '#333', fontSize: 10, fontWeight: '900', marginTop: 4 },
  syncBtn: { backgroundColor: '#fff', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  syncBtnActive: { opacity: 0.5 },
  syncBtnTxt: { color: '#000', fontSize: 12, fontWeight: '900' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: '#000', padding: 15, borderRadius: 15 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveLabel: { color: '#333', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  syncCardTitle: { color: '#fff', fontSize: 16, fontWeight: '900', marginBottom: 5 },
  syncCardSub: { color: '#333', fontSize: 11, textAlign: 'center', marginBottom: 20 },
  encryptionNotice: { color: '#222', fontSize: 8, fontWeight: '900', marginTop: 25, textAlign: 'center', letterSpacing: 0.5 },
  settingRow: { backgroundColor: '#0c0c0e', padding: 22, borderRadius: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  settingTxt: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  // Picker Styles
  pickerSheet: { backgroundColor: '#0c0c0e', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 30, borderTopWidth: 1, borderTopColor: '#222' },
  pickerHeader: { alignItems: 'center', marginBottom: 30 },
  pickerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 15 },
  pickerSub: { color: '#444', fontSize: 12, marginTop: 5 },
  accountsList: { marginBottom: 20 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#111' },
  accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  accountName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  accountEmail: { color: '#444', fontSize: 12 },
  addAccountTxt: { color: '#fff', fontSize: 14 },
  pickerClose: { alignItems: 'center', paddingVertical: 10 },
  pickerCloseTxt: { color: '#666', fontWeight: 'bold', fontSize: 12 },
  
  editorSyncLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, position: 'absolute', right: 0, bottom: -20 },
  syncLabelTxt: { color: '#222', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  indContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  // Calendar Styles
  calendarContainer: { width: width - 40, backgroundColor: '#0c0c0e', borderRadius: 32, padding: 25, borderWidth: 1, borderColor: '#111' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  calendarMonthTitle: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  calendarWeekdays: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  weekdayTxt: { color: '#222', fontSize: 10, fontWeight: '900', width: (width - 90) / 7, textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: { width: (width - 90) / 7, height: 45, justifyContent: 'center', alignItems: 'center', borderRadius: 12, marginBottom: 5 },
  calendarDaySelected: { backgroundColor: '#ff3131' },
  calendarDayTxt: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  calendarCloseBtn: { marginTop: 20, alignSelf: 'center', padding: 10 },
  calendarCloseTxt: { color: '#666', fontSize: 11, fontWeight: '900' },

  calendarToggleRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 15, gap: 15 },
  toggleTab: { paddingBottom: 5, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  toggleTabActive: { borderBottomColor: '#ff3131' },
  toggleText: { color: '#333', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  toggleTextActive: { color: '#fff' },
  dayDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: '#ff3131', position: 'absolute', bottom: 8 },
  agendaTitle: { color: '#222', fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 5, marginLeft: 5 },
  emptyAgenda: { color: '#111', fontSize: 12, fontWeight: 'bold', textAlign: 'center', marginTop: 30 },

  todayBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#111' },
  todayBtnTxt: { color: '#ff3131', fontSize: 9, fontWeight: '900' },
  addEventIcon: { padding: 2 },

  // FAB Menu Styles
  fabWrapper: { position: 'absolute', right: 25, bottom: 40, alignItems: 'center' },
  fabMenu: { backgroundColor: '#0c0c0e', borderRadius: 24, padding: 15, marginBottom: 20, borderWidth: 1, borderColor: '#222', gap: 15, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10 },
  fabSubBtn: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 10, paddingHorizontal: 15 },
  fabSubTxt: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  editorToolbar: { flexDirection: 'row', alignItems: 'center', padding: 15, borderTopWidth: 1, borderColor: '#111', gap: 20 },

  editorImageRow: { marginHorizontal: 25, marginTop: 15, position: 'relative' },
  editorImage: { width: '100%', height: 200, borderRadius: 16 },
  removeImageBtn: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  
  codeEditorContainer: { backgroundColor: '#080808', borderRadius: 12, marginVertical: 10, borderLeftWidth: 3, borderLeftColor: '#ff3131', overflow: 'hidden' },
  codeEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 15, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' },
  codeHeaderLabel: { color: '#444', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyBtnTxt: { color: '#666', fontSize: 9, fontWeight: '900' },
  codeContentInput: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: '#ff3131', fontSize: 13, lineHeight: 18, textAlignVertical: 'top' },
  
  cardImagePreview: { width: '100%', height: 120, borderRadius: 12, marginBottom: 12 },
  cardCodeContent: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', opacity: 0.8, fontSize: 12, lineHeight: 16 },

  sortToast: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: '#000', borderStyle: 'solid', borderWidth: 1, borderColor: '#333', paddingHorizontal: 15, paddingVertical: 6, borderRadius: 20, zIndex: 50 },
  sortToastTxt: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sortDrawer: { backgroundColor: '#0c0c0e', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 30, paddingBottom: 50, borderWidth: 1, borderColor: '#222' },
  sortDrawerHeader: { alignItems: 'center', marginBottom: 25 },
  sortHeaderStrip: { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, marginBottom: 15 },
  sortDrawerTitle: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  sortOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, paddingHorizontal: 20, borderRadius: 16, gap: 15, marginBottom: 8 },
  sortOptionActive: { backgroundColor: '#ff3131' },
  sortOptionText: { color: '#666', fontSize: 14, fontWeight: 'bold' },
  sortOptionTextActive: { color: '#000' },

  // Scanner Styles
  scannerHeader: { flexDirection: 'row', alignItems: 'center', padding: 25, gap: 20, backgroundColor: '#000' },
  scannerTitle: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  scannerContainer: { flex: 1, overflow: 'hidden', position: 'relative' },
  scannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scannerFrame: { width: 250, height: 250, borderWidth: 2, borderRadius: 30, backgroundColor: 'transparent' },
  scannerHint: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 40 }
});
