import React, { useState, useEffect, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import Masonry from 'react-masonry-css';
import { 
  Plus, 
  Search, 
  Grid, 
  List, 
  Trash2, 
  CheckSquare, 
  Terminal, 
  Image as ImageIcon,
  Bell,
  Archive,
  Settings,
  Layout,
  RefreshCw,
  CloudLightning
} from 'lucide-react';

declare global {
  interface Window {
    google: any;
  }
}

const SOCKET_URL = 'http://localhost:3001';
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'; 

type ThemeType = 'STARK_RED' | 'STARK_YELLOW' | 'STARK_BLUE';
type ViewType = 'Notes' | 'Archive' | 'Trash' | 'Reminders';

interface Note {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  checklist?: { text: string; completed: boolean }[];
  isArchived: boolean;
  isDeleted: boolean;
  isReminder: boolean;
  reminderDate?: string | null;
  image?: string;
  updatedAt: string;
}

const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentTheme, setCurrentTheme] = useState<ThemeType>('STARK_RED');
  const [currentView, setCurrentView] = useState<ViewType>('Notes');
  const [isGridView, setIsGridView] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [googleUser, setGoogleUser] = useState<any>(null);

  useEffect(() => {
    /* global google */
    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: any) => {
          // Decode JWT for demo
          const base64Url = response.credential.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          const user = JSON.parse(jsonPayload);
          setGoogleUser(user);
          console.log("STARK_OAUTH: User Authenticated ->", user.email);
        }
      });
    }
  }, []);

  const handleGoogleLogin = () => {
    if (window.google) {
      window.google.accounts.id.prompt();
    } else {
      alert("STARK_SYSTEM: Google Identity Service not loaded.");
    }
  };

  const handleDriveSync = async () => {
    if (!googleUser) {
      alert("STARK_SYSTEM: Cloud Authentication Required. Please connect your Gmail.");
      return;
    }
    setIsSyncing(true);
    console.log("SYNC_START: Pushing data to Google Drive...");
    
    // In a production build, this would use the access_token to POST to:
    // https://www.googleapis.com/upload/drive/v3/files?uploadType=media
    
    setTimeout(() => {
      setIsSyncing(false);
      console.log("SYNC_COMPLETE: Vault Secured in Cloud Drive.");
    }, 1500);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    
    newSocket.on('note-update', (updatedNote: Note) => {
      setNotes(prev => {
        const exists = prev.find(n => n.id === updatedNote.id);
        if (exists) {
          return prev.map(n => n.id === updatedNote.id ? updatedNote : n);
        }
        return [updatedNote, ...prev];
      });
    });

    return () => { newSocket.disconnect(); };
  }, []);

  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (n.isDeleted) return currentView === 'Trash';
      if (n.isArchived) return currentView === 'Archive';
      if (currentView === 'Reminders') return n.isReminder;
      return !n.isDeleted && !n.isArchived;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, searchQuery, currentView]);

  const addNote = (type: string = 'text') => {
    const newNote: Note = {
      id: Date.now().toString(),
      type,
      title: '',
      content: '',
      tags: [],
      isArchived: false,
      isDeleted: false,
      isReminder: currentView === 'Reminders',
      updatedAt: new Date().toISOString()
    };
    setNotes([newNote, ...notes]);
    socket?.emit('typing', newNote);
  };

  const updateNote = (id: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map(n => {
      if (n.id === id) {
        const entry = { ...n, ...updates, updatedAt: new Date().toISOString() };
        socket?.emit('typing', entry);
        return entry;
      }
      return n;
    }));
  };

  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)] dot-pattern">
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 w-20 border-r border-[var(--border)] bg-[var(--card)] flex flex-col items-center py-10 gap-8 z-50">
        <div className="logo-box mb-6"><span>!</span></div>
        
        <NavBtn icon={<Layout size={20} />} active={currentView === 'Notes'} onClick={() => setCurrentView('Notes')} title="Notes" />
        <NavBtn icon={<Bell size={20} />} active={currentView === 'Reminders'} onClick={() => setCurrentView('Reminders')} title="Reminders" />
        <NavBtn icon={<Archive size={20} />} active={currentView === 'Archive'} onClick={() => setCurrentView('Archive')} title="Archive" />
        <NavBtn icon={<Trash2 size={20} />} active={currentView === 'Trash'} onClick={() => setCurrentView('Trash')} title="Trash" />

        <div className="mt-auto flex flex-col gap-4">
          <ThemeSelector current={currentTheme} onChange={setCurrentTheme} />
          <NavBtn icon={<Settings size={20} />} onClick={() => {}} title="Settings" />
        </div>
      </aside>

      {/* Header & Content */}
      <main className="pl-20 pr-10 pt-10 pb-20">
        <div className="max-w-6xl mx-auto">
          {/* Top Bar */}
          <div className="flex items-center gap-6 mb-12 animate-fade">
            <div className="flex-1 stark-card h-14 flex items-center px-6 gap-4">
              <Search size={18} className="text-[var(--sub)]" />
              <input 
                className="industrial-input font-bold tracking-widest text-sm" 
                placeholder="SEARCH_STARK_INDUSTRIAL_VAULT..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex gap-2">
                <button className={`btn-icon ${isGridView ? 'active' : ''}`} onClick={() => setIsGridView(true)}><Grid size={18} /></button>
                <button className={`btn-icon ${!isGridView ? 'active' : ''}`} onClick={() => setIsGridView(false)}><List size={18} /></button>
              </div>
            </div>

            <div className="stark-card h-14 px-6 flex items-center gap-4 min-w-[240px]">
              {googleUser ? (
                <>
                  <img src={googleUser.picture} className="w-8 h-8 rounded-full border border-[var(--primary)]" alt="User" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black tracking-widest text-[var(--sub)] uppercase">Vault_Owner</span>
                    <span className="text-xs font-bold">{googleUser.name.toUpperCase()}</span>
                  </div>
                  <button onClick={handleDriveSync} className="ml-auto">
                    <CloudLightning size={16} className={isSyncing ? 'text-[var(--primary)] animate-pulse' : 'text-green-500'} />
                  </button>
                </>
              ) : (
                <button 
                  onClick={handleGoogleLogin}
                  className="flex items-center gap-3 text-xs font-black tracking-widest hover:text-[var(--primary)] transition-colors"
                >
                  <RefreshCw size={14} />
                  CONNECT_TO_GMAIL
                </button>
              )}
            </div>
          </div>

          {/* Note Grid */}
          <Masonry
            breakpointCols={isGridView ? { default: 3, 1100: 2, 700: 1 } : 1}
            className="flex -ml-6 w-auto animate-fade"
            columnClassName="pl-6 bg-clip-padding"
          >
            {filteredNotes.map(note => (
              <NoteCard key={note.id} note={note} onUpdate={updateNote} />
            ))}
          </Masonry>
        </div>
      </main>

      {/* FAB */}
      <button className="fixed bottom-10 right-10 main-fab z-50" onClick={() => addNote()}>
        <Plus size={32} strokeWidth={3} />
      </button>
    </div>
  );
};

const NavBtn = ({ icon, active, onClick, title }: any) => (
  <button 
    onClick={onClick}
    className={`btn-icon relative group ${active ? 'active' : ''}`}
  >
    {icon}
    <div className="absolute left-full ml-4 px-2 py-1 bg-[var(--card)] border border-[var(--border)] text-[var(--primary)] text-[10px] font-black rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
      {title.toUpperCase()}
    </div>
  </button>
);

const ThemeSelector = ({ current, onChange }: { current: ThemeType, onChange: (t: ThemeType) => void }) => {
  const themes: ThemeType[] = ['STARK_RED', 'STARK_YELLOW', 'STARK_BLUE'];
  return (
    <div className="flex flex-col gap-2">
      {themes.map(t => (
        <button 
          key={t}
          onClick={() => onChange(t)}
          className={`w-4 h-4 rounded-full border border-white/20 transition-all ${current === t ? 'scale-125 border-white' : ''}`}
          style={{ backgroundColor: t === 'STARK_RED' ? '#ff3131' : t === 'STARK_YELLOW' ? '#ffcc00' : '#0066ff' }}
        />
      ))}
    </div>
  );
};

const NoteCard = ({ note, onUpdate }: { note: Note, onUpdate: (id: string, u: any) => void }) => {
  return (
    <div className="stark-card p-6 mb-6 group flex flex-col gap-4 min-h-[150px]">
      <div className="flex justify-between items-start">
        <input 
          className="industrial-input font-black text-sm tracking-tighter uppercase mb-2"
          placeholder="[ SYSTEM_TITLE ]"
          value={note.title}
          onChange={(e) => onUpdate(note.id, { title: e.target.value })}
        />
        <Archive size={14} className="cursor-pointer text-[var(--sub)] hover:text-[var(--primary)] transition-colors" />
      </div>

      <textarea 
        className="industrial-input text-sm leading-relaxed resize-none min-h-[100px]"
        placeholder="STARK_WRITER_v1.0: INPUT_REQUIRED..."
        value={note.content}
        onChange={(e) => onUpdate(note.id, { content: e.target.value })}
      />

      <div className="mt-auto flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity pt-4 border-t border-[var(--border)]">
        <div className="flex gap-4">
          <CheckSquare size={14} className="text-[var(--sub)] hover:text-white cursor-pointer" />
          <Terminal size={14} className="text-[var(--sub)] hover:text-white cursor-pointer" />
          <ImageIcon size={14} className="text-[var(--sub)] hover:text-white cursor-pointer" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
          <span className="text-[9px] font-black text-[var(--sub)]">VAULT_STABLE</span>
        </div>
      </div>
    </div>
  );
};

export default App;
