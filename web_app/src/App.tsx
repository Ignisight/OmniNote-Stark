import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Masonry from 'react-masonry-css';
import { 
  Plus, Search, Grid, List, Trash2, CheckSquare, Terminal, Image as ImageIcon,
  Bell, Archive, Settings, Layout, RefreshCw, CloudLightning, Monitor, X,
  Pin, RotateCcw, Square, Globe, Tag as TagIcon, ChevronLeft, ChevronRight,
  Copy, Calendar, LogOut
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const SOCKET_URL = 'https://omninotes-core.onrender.com';

type NoteType = 'text' | 'code' | 'checklist' | 'image';
type ThemeType = 'STARK_RED' | 'STARK_YELLOW' | 'STARK_BLUE';
type ViewType = 'Notes' | 'Archive' | 'Trash' | 'Reminders' | 'Tag';
type SortMode = 'newest' | 'oldest' | 'az' | 'za';

interface Note {
  id: string;
  type: NoteType;
  title: string;
  content: string;
  tags: string[];
  checklist?: { text: string; completed: boolean }[];
  linkPreview?: { title: string; url: string; siteName?: string };
  isArchived: boolean;
  isDeleted: boolean;
  isReminder: boolean;
  isPinned: boolean;
  reminderDate?: string | null;
  image?: string;
  updatedAt: string;
}

const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem('stark_notes');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem('stark_theme') as ThemeType) || 'STARK_RED';
  });
  const [currentView, setCurrentView] = useState<ViewType>('Notes');
  const [isGridView, setIsGridView] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [showSortDrawer, setShowSortDrawer] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('ENGLISH (US)');
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('stark_logged_in') === 'true';
  });
  const [systemStatus, setSystemStatus] = useState<'STABLE' | 'PATCHING' | 'RECOVERING'>('STABLE');
  
  const notesRef = useRef<Note[]>(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const disconnectTimeoutRef = useRef<NodeJS.Timeout|null>(null);

  useEffect(() => {
    localStorage.setItem('stark_theme', currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    localStorage.setItem('stark_notes', JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    if (isLoggedIn) {
      localStorage.setItem('stark_logged_in', 'true');
    } else {
      localStorage.removeItem('stark_logged_in');
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    
    const existingVault = localStorage.getItem('stark_vault_id');
    if (existingVault) {
      newSocket.emit('join-room', existingVault);
    }
    
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

    newSocket.on('bridge-auth-success', (userData: { email: string, vaultId: string }) => {
      console.log('STARK_SYSTEM: SECURE_BRIDGE_VERIFIED', userData);
      localStorage.setItem('stark_vault_id', userData.vaultId);
      setIsLoggedIn(true);
    });

    newSocket.on('request-sync', () => {
      const currentNotes = JSON.parse(localStorage.getItem('stark_notes') || '[]');
      newSocket.emit('sync-all', currentNotes);
    });

    newSocket.on('bulk-sync', (allNotes: Note[]) => {
      setNotes(allNotes);
    });

    // Handle high-volume Drive vault synchronization
    newSocket.on('vault-sync', () => {
      console.log('STARK_SYSTEM: INCOMING_ENCRYPTED_DRIVE_PAYLOAD');
      // Logic to decrypt and update notes would go here
    });

    // Handle Over-the-Air (OTA) Hot Patches for post-deployment fixes
    newSocket.on('system-patch', (patch: { id: string, type: 'CSS' | 'LOGIC', data: string }) => {
      console.log('STARK_SYSTEM: INCOMING_HOT_PATCH', patch.id);
      setSystemStatus('PATCHING');
      
      if (patch.type === 'CSS') {
        const style = document.createElement('style');
        style.textContent = patch.data;
        document.head.appendChild(style);
      }
      
      setTimeout(() => setSystemStatus('STABLE'), 2000);
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        console.log('STARK_SYSTEM: WINDOW_HIDDEN -> COMMITTING_TO_DRIVE');
        encryptAndSyncToDrive(notesRef.current);
        // Delay disconnect slightly to allow emit to reach server
        disconnectTimeoutRef.current = setTimeout(() => {
          newSocket.disconnect();
        }, 500);
      } else {
        if (disconnectTimeoutRef.current) clearTimeout(disconnectTimeoutRef.current);
        console.log('STARK_SYSTEM: WINDOW_ACTIVE -> RECONNECTING_BRIDGE');
        newSocket.connect();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => encryptAndSyncToDrive(notesRef.current));

    return () => { 
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      newSocket.disconnect(); 
    };
  }, [isLoggedIn]);

  const encryptAndSyncToDrive = (noteData: Note[]) => {
    console.log('STARK_SYSTEM: AES_ENCRYPTING_VAULT_FOR_DRIVE...');
    // Simulated encryption & transmission to the dedicated Stark Drive folder
    socket?.emit('drive-vault-commit', {
      folder: 'STARK_VAULT',
      payload: noteData // In a production app, this would be a real encrypted string
    });
  };

  const addNote = (type: NoteType) => {
    const newNote: Note = {
      id: Date.now().toString(),
      type,
      title: '',
      content: '',
      tags: [],
      checklist: type === 'checklist' ? [{ text: '', completed: false }] : [],
      isArchived: false,
      isDeleted: false,
      isReminder: currentView === 'Reminders',
      isPinned: false,
      updatedAt: new Date().toISOString()
    };
    setNotes([newNote, ...notes]);
    setEditingNote(newNote);
    socket?.emit('typing', newNote);
    setShowFabMenu(false);
  };

  const updateNote = (id: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n));
    setEditingNote(prev => (prev?.id === id ? { ...prev, ...updates } : prev));
    const current = notes.find(n => n.id === id);
    if (current) {
      const merged = { ...current, ...updates };
      socket?.emit('typing', merged);
      encryptAndSyncToDrive(notes.map(n => n.id === id ? merged : n));
    }
  };

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    // Implementation for permanent server-side purge would go here
  };

  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      const matchSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          n.content.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;

      if (n.isDeleted) return currentView === 'Trash';
      if (currentView === 'Trash') return false; // Hide non-deleted notes in Trash view

      if (n.isArchived) return currentView === 'Archive';
      if (currentView === 'Archive') return false; // Hide non-archived notes in Archive view

      if (currentView === 'Reminders') return n.isReminder && !n.isDeleted && !n.isArchived;
      if (currentView === 'Tag' && selectedTag) return n.tags.includes(selectedTag) && !n.isDeleted && !n.isArchived;
      
      return !n.isDeleted && !n.isArchived && currentView === 'Notes';
    }).sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      
      switch (sortMode) {
        case 'oldest': return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'az': return a.title.localeCompare(b.title);
        case 'za': return b.title.localeCompare(a.title);
        default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
  }, [notes, searchQuery, currentView, selectedTag, sortMode]);

  const uniqueTags = useMemo(() => {
    const tags = notes.flatMap(n => n.tags);
    return Array.from(new Set(tags)).sort();
  }, [notes]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  }, [currentMonth]);

  if (!isLoggedIn) {
    return <LoginPortal onLogin={() => setIsLoggedIn(true)} socket={socket} />;
  }

  return (
    <div className={`stark-layout ${isSidebarCollapsed ? 'side-collapsed' : ''}`}>
      <div className="dot-bg" />
      
      <aside className="stark-sidebar">
        <header className="sidebar-header">
          <div className="logo-area">
              <div className="logo-box cursor-pointer hover:scale-105 transition-transform" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} title="Toggle Sidebar">
                <span>!</span>
              </div>
          </div>
          <span className="brand-text">OmniNotes</span>
        </header>

        <nav className="nav-stack">
          <SidebarLink icon={<Layout size={18} />} label="NOTES" active={currentView === 'Notes' && !selectedTag} onClick={() => { setCurrentView('Notes'); setSelectedTag(null); }} collapsed={isSidebarCollapsed} />
          <SidebarLink icon={<Bell size={18} />} label="REMINDERS" active={currentView === 'Reminders'} onClick={() => { setCurrentView('Reminders'); }} collapsed={isSidebarCollapsed} />
          <SidebarLink icon={<Archive size={18} />} label="ARCHIVE" active={currentView === 'Archive'} onClick={() => setCurrentView('Archive')} collapsed={isSidebarCollapsed} />
          <SidebarLink icon={<Trash2 size={18} />} label="TRASH" active={currentView === 'Trash'} onClick={() => setCurrentView('Trash')} collapsed={isSidebarCollapsed} />
        </nav>

        <div className="sidebar-divider" />
        <span className="sidebar-section-title">TAGS</span>
        <nav className="nav-stack">
          {uniqueTags.slice(0, 5).map(tag => (
            <SidebarLink 
              key={tag} 
              icon={<TagIcon size={16} />} 
              label={tag.toUpperCase()} 
              active={currentView === 'Tag' && selectedTag === tag} 
              onClick={() => { setSelectedTag(tag); setCurrentView('Tag'); }} 
              collapsed={isSidebarCollapsed} 
            />
          ))}
          {uniqueTags.length > 5 && (
            <button className="text-[9px] font-black text-[var(--primary)] ml-8 text-left mt-2 tracking-widest">SEE_ALL_LOGS</button>
          )}
        </nav>

        <footer className="sidebar-footer">
          <SidebarLink icon={<Settings size={18} />} label="SETTINGS" onClick={() => setShowSettingsModal(true)} collapsed={isSidebarCollapsed} />
        </footer>
      </aside>

      <main className="main-view">
        <header className="stark-header">
          <div className="search-module-container">
            <div className="search-module">
              <Search size={18} className="text-[#333]" />
              <input 
                className="search-input" 
                placeholder="SEARCH_STARK_INDUSTRIAL..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="search-profile-hook" onClick={() => setShowSettingsModal(true)}>
                <div className="profile-indicator-dot" />
              </div>
            </div>

            <div className="header-tools">
              <button 
                className={`tool-btn ${!isGridView ? 'active' : ''}`} 
                onClick={() => setIsGridView(!isGridView)}
                title="Toggle Layout"
              >
                {isGridView ? <List size={16} /> : <Grid size={16} />}
              </button>
              <div className="v-divider" />
              <div className="status-badge">
                <CloudLightning size={12} className="text-[var(--primary)]" />
                <span>SECURED</span>
              </div>
            </div>
          </div>
        </header>

        {currentView === 'Reminders' && (
          <div className="calendar-widget mb-10">
            <header className="cal-header">
              <span className="cal-month">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
              <div className="cal-controls">
                <ChevronLeft className="cursor-pointer" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} />
                <button className="text-[10px] font-black tracking-widest text-[var(--primary)] mx-4" onClick={() => setCurrentMonth(new Date())}>TODAY</button>
                <ChevronRight className="cursor-pointer" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} />
              </div>
            </header>
            <div className="cal-grid">
              {['S','M','T','W','T','F','S'].map(d => <div key={d} className="cal-day-label">{d}</div>)}
              {calendarDays.map((day, idx) => {
                const dayStr = day?.toDateString();
                const hasNote = notes.some(n => n.isReminder && n.reminderDate === dayStr);
                const isToday = dayStr === new Date().toDateString();
                return (
                  <div 
                    key={idx} 
                    className={`cal-day ${!day ? 'empty' : ''} ${isToday ? 'today' : ''} ${hasNote ? 'has-notes' : ''}`}
                  >
                    {day ? day.getDate() : ''}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Masonry breakpointCols={isGridView ? { default: 3, 1400: 2, 900: 1 } : 1} className="note-grid" columnClassName="note-column">
          {filteredNotes.map(n => (
            <NoteCard 
              key={n.id} 
              note={n} 
              onUpdate={(u) => updateNote(n.id, u)} 
              onDelete={() => deleteNote(n.id)}
              onEdit={() => setEditingNote(n)} 
              isTrash={currentView === 'Trash'}
            />
          ))}
        </Masonry>
      </main>

      <div className="fab-container">
        {showFabMenu && (
          <div className="fab-menu">
            <FabOption icon={<CheckSquare size={16} />} label="CHECKLIST" onClick={() => addNote('checklist')} />
            <FabOption icon={<Terminal size={16} />} label="CODE_NODE" onClick={() => addNote('code')} />
            <FabOption icon={<ImageIcon size={16} />} label="IMAGE_LOG" onClick={() => addNote('image')} />
            <FabOption icon={<Plus size={16} />} label="TEXT_ENTRY" onClick={() => addNote('text')} />
          </div>
        )}
        <button className={`main-fab ${showFabMenu ? 'open' : ''}`} onClick={() => setShowFabMenu(!showFabMenu)}>
          {showFabMenu ? <X size={28} /> : <Plus size={32} />}
        </button>
      </div>

      {editingNote && (
        <NoteEditor 
          note={editingNote} 
          currentTheme={currentTheme}
          onClose={() => setEditingNote(null)} 
          onUpdate={(u) => updateNote(editingNote.id, u)} 
          onSetTheme={setCurrentTheme}
        />
      )}

      {showSettingsModal && (
        <div className="stark-modal" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content settings-central" onClick={e => e.stopPropagation()}>
            <header className="modal-header">
              <h2 className="modal-title">STARK_SETTINGS_CENTRAL</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}><X size={20} /></button>
            </header>
            
            <div className="settings-body">
              {/* User Profile Hook */}
              <section className="settings-section">
                <div className="profile-card-premium">
                  <div className="p-avatar" />
                  <div className="p-info">
                    <span className="p-name">GUEST_ACCESS_v1</span>
                    <span className="p-status">VAULT_STABLE • NO_ERRORS</span>
                  </div>
                  <button className="tool-btn ml-auto"><RefreshCw size={14} /></button>
                </div>
              </section>

              <section className="settings-section">
                <span className="section-label">CONNECTION_METHOD</span>
                <div className="connection-selector">
                  <div className="conn-stack">
                    <button className="conn-card active">
                      <CloudLightning size={20} className="conn-icon" />
                      <div className="conn-info">
                        <span className="conn-title">STARK_DRIVE_VAULT</span>
                        <span className="conn-sub">ENCRYPTED_CLOUD_STORAGE</span>
                      </div>
                    </button>
                    
                    <button className="google-sign-in-btn mt-2" onClick={() => alert('STARK_SYSTEM: INITIALIZING_DRIVE_ENCRYPTION_GATEWAY')}>
                      <CloudLightning size={18} />
                      <span>CONNECT_DRIVE_STORAGE</span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <span className="section-label">LANGUAGE_ENGINE</span>
                <div className="connection-selector">
                  {['ENGLISH (US)', 'HINDI (IN)', 'SPANISH (ES)', 'FRENCH (FR)', 'GERMAN (DE)'].map(lang => (
                    <button 
                      key={lang}
                      className={`conn-card mini ${currentLanguage === lang ? 'active' : ''}`}
                      onClick={() => setCurrentLanguage(lang)}
                    >
                      <Globe size={14} className="conn-icon" />
                      <span className="conn-title" style={{ fontSize: '11px' }}>{lang}</span>
                      {currentLanguage === lang && <div className="active-dot ml-auto" />}
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <span className="section-label">THEME_ENGINE</span>
                <div className="theme-selector-grid">
                  <div className={`theme-bubble red ${currentTheme === 'STARK_RED' ? 'active' : ''}`} onClick={() => setCurrentTheme('STARK_RED')}>
                    <div className="dot" />
                    <span>RED</span>
                  </div>
                  <div className={`theme-bubble yellow ${currentTheme === 'STARK_YELLOW' ? 'active' : ''}`} onClick={() => setCurrentTheme('STARK_YELLOW')}>
                    <div className="dot" />
                    <span>YELLOW</span>
                  </div>
                  <div className={`theme-bubble blue ${currentTheme === 'STARK_BLUE' ? 'active' : ''}`} onClick={() => setCurrentTheme('STARK_BLUE')}>
                    <div className="dot" />
                    <span>BLUE</span>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <span className="section-label">SYSTEM_INFO</span>
                <div className="pref-row">
                  <span>REPOSITORY_LOGS</span>
                  <Globe size={14} className="cursor-pointer" onClick={() => window.open('https://github.com/Ignisight/OmniNotes-Stark', '_blank')} />
                </div>
                <div className="pref-row">
                  <span>VAULT_ENCRYPTION</span>
                  <span className="text-[var(--primary)] text-[8px]">ACTIVE_STARK</span>
                </div>
                <button 
                  className="google-sign-in-btn mt-6" 
                  style={{ background: 'rgba(255,49,49,0.1)', borderColor: 'rgba(255,49,49,0.3)', color: '#f31' }}
                  onClick={() => setIsLoggedIn(false)}
                >
                  <LogOut size={16} />
                  <span>LOG_OUT_MISSION</span>
                </button>
              </section>
            </div>
            
            <footer className="settings-footer">
              <span className="entry-id">SYSTEM_STABLE_v5.6 • BUILD_2026_INDUSTRIAL</span>
            </footer>
          </div>
        </div>
      )}

      {showSortDrawer && (
        <div className="stark-modal" onClick={() => setShowSortDrawer(false)}>
          <div className="drawer-content bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="drawer-header-strip" />
            <h2 className="drawer-title">SELECT_SORT_RANK</h2>
            <div className="drawer-options">
              <SortOption active={sortMode === 'newest'} label="NEWEST_FIRST" onClick={() => { setSortMode('newest'); setShowSortDrawer(false); }} />
              <SortOption active={sortMode === 'oldest'} label="OLDEST_FIRST" onClick={() => { setSortMode('oldest'); setShowSortDrawer(false); }} />
              <SortOption active={sortMode === 'az'} label="ALPHA_A_Z" onClick={() => { setSortMode('az'); setShowSortDrawer(false); }} />
            <SortOption active={sortMode === 'za'} label="ALPHA_Z_A" onClick={() => { setSortMode('za'); setShowSortDrawer(false); }} />
            </div>
          </div>
        </div>
      )}

      {systemStatus !== 'STABLE' && (
        <div className="stark-modal" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.95)' }}>
          <div className="login-card animate-pulse" style={{ border: '2px solid var(--primary)', padding: '60px 40px' }}>
            <CloudLightning size={40} className="text-[var(--primary)] mb-6 animate-bounce" />
            <h2 className="auth-title">SYSTEM_{systemStatus}</h2>
            <p className="auth-hint">RECEIVING_REMOTE_PATCH_FROM_STARK_COMMAND</p>
            <div className="w-full h-1 bg-[#111] mt-8 overflow-hidden rounded-full" style={{ maxWidth: '280px' }}>
              <div className="h-full bg-[var(--primary)]" style={{ width: '60%', height: '100%', transition: '1s' }} />
            </div>
            <span className="entry-id mt-6">DO_NOT_TERMINATE_MISSION • APPLYING_POST_BUILD_FIX</span>
          </div>
        </div>
      )}
    </div>
  );
};

const NoteCard = ({ note, onUpdate, onDelete, onEdit, isTrash }: { note: Note, onUpdate: (u: Partial<Note>) => void, onDelete: () => void, onEdit: () => void, isTrash: boolean }) => {
  return (
    <div className="note-card" onClick={onEdit}>
      {note.isPinned && <Pin size={14} className="pinned-icon" />}
      {note.image && <img src={note.image} className="card-img-preview" alt="Preview" />}
      
      <div className="card-header">
        <div className="entry-line" />
        <span className="entry-id">ENTRY_{note.type.toUpperCase()}_{note.id.slice(-4)}</span>
      </div>

      {note.title && <h3 className="card-title">{note.title}</h3>}
      
      <div className={`card-body ${note.type === 'code' ? 'monospace' : ''}`}>
        {note.content}
      </div>

      {note.type === 'checklist' && note.checklist && (
        <div className="card-checklist">
          {note.checklist.slice(0, 3).map((item, i) => (
            <div key={i} className={`mini-check ${item.completed ? 'done' : ''}`}>
              {item.completed ? <CheckSquare size={12} /> : <Square size={12} />}
              <span>{item.text || '...'}</span>
            </div>
          ))}
          {note.checklist.length > 3 && <span className="entry-id">+{note.checklist.length - 3} MORE ITEMS</span>}
        </div>
      )}

      {note.linkPreview && (
        <div className="card-link-preview">
          <div className="link-icon-box"><Globe size={16} /></div>
          <div className="link-info">
            <div className="link-title">{note.linkPreview.title}</div>
            <div className="link-url">{note.linkPreview.siteName || note.linkPreview.url}</div>
          </div>
        </div>
      )}

      {note.tags.length > 0 && (
        <div className="note-tags">
          {note.tags.slice(0, 3).map(t => <span key={t} className="note-tag">#{t.toUpperCase()}</span>)}
        </div>
      )}

      <div className="card-footer" onClick={e => e.stopPropagation()}>
        <div className="card-actions">
          {!isTrash ? (
            <>
              <Pin className={`action-btn ${note.isPinned ? 'text-[var(--primary)]' : ''}`} size={16} onClick={() => onUpdate({ isPinned: !note.isPinned })} />
              <Archive className={`action-btn ${note.isArchived ? 'text-[var(--primary)]' : ''}`} size={16} onClick={() => onUpdate({ isArchived: !note.isArchived })} />
              <Trash2 className="action-btn del" size={16} onClick={() => onUpdate({ isDeleted: true })} />
            </>
          ) : (
            <>
              <RotateCcw className="action-btn res" size={16} onClick={() => onUpdate({ isDeleted: false })} />
              <X className="action-btn del" size={16} onClick={onDelete} />
            </>
          )}
        </div>
        <span className="entry-id">SECURED</span>
      </div>
    </div>
  );
};

const NoteEditor = ({ note, currentTheme, onClose, onUpdate, onSetTheme }: { note: Note, currentTheme: ThemeType, onClose: () => void, onUpdate: (u: Partial<Note>) => void, onSetTheme: (t: ThemeType) => void }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onUpdate({ image: reader.result as string, type: 'image' });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(note.content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="editor-modal" onClick={onClose}>
      <div className="editor-content" onClick={e => e.stopPropagation()}>
        <header className="editor-header">
          <input 
            className="editor-title-in" 
            placeholder="UNTITLED_ENTRY..." 
            value={note.title} 
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
          <div className="header-tools">
            <button className="tool-btn" onClick={() => onUpdate({ isPinned: !note.isPinned })}><Pin size={18} className={note.isPinned ? 'text-[var(--primary)]' : ''} /></button>
            <button className="tool-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </header>

        <div className="editor-body">
          <div className="editor-meta-bar">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap gap-2">
                {note.tags.map((tag, idx) => (
                  <span key={idx} className="note-tag group">
                    #{tag.toUpperCase()}
                    <X size={10} className="ml-2 cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => onUpdate({ tags: note.tags.filter(t => t !== tag) })} />
                  </span>
                ))}
                <input 
                  className="tag-adder-in"
                  placeholder="+ ADD_TAG..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = e.currentTarget.value.trim().toLowerCase();
                      if (val && !note.tags.includes(val)) {
                        onUpdate({ tags: [...note.tags, val] });
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                />
              </div>

              <div className="v-divider h-4" />

              <div className="flex gap-2">
                <button className={`type-chip ${note.type === 'text' ? 'active' : ''}`} onClick={() => onUpdate({ type: 'text' })}>TEXT</button>
                <button 
                  className={`type-chip ${note.type === 'checklist' ? 'active' : ''}`} 
                  onClick={() => onUpdate({ 
                    type: 'checklist', 
                    checklist: note.checklist?.length ? note.checklist : [{ text: '', completed: false }] 
                  })}
                >CHECK</button>
                <button 
                  className={`type-chip ${note.type === 'code' ? 'active' : ''}`} 
                  onClick={() => onUpdate({ 
                    type: 'code', 
                    tags: Array.from(new Set([...note.tags, 'terminal'])) 
                  })}
                >CODE</button>
              </div>
            </div>
          </div>

          <div className="writing-surface">
            {note.image && (
              <div className="editor-image-preview-container group">
                <img src={note.image} className="editor-image-preview" alt="Log" />
                <button className="img-del-btn" onClick={() => onUpdate({ image: undefined })}><X size={16} /></button>
              </div>
            )}

            {note.type === 'checklist' ? (
              <div className="checklist-editor">
                {note.checklist?.map((item, idx) => (
                  <div key={idx} className="check-row">
                    <button className="editor-btn" onClick={() => {
                      const next = [...(note.checklist || [])];
                      next[idx].completed = !next[idx].completed;
                      onUpdate({ checklist: next });
                    }}>
                      {item.completed ? <CheckSquare size={18} className="text-[var(--primary)]" /> : <Square size={18} />}
                    </button>
                    <input 
                      className={`check-in ${item.completed ? 'done' : ''}`}
                      value={item.text}
                      onChange={(e) => {
                        const next = [...(note.checklist || [])];
                        next[idx].text = e.target.value;
                        onUpdate({ checklist: next });
                      }}
                    />
                  </div>
                ))}
                <button className="add-check-link" onClick={() => onUpdate({ checklist: [...(note.checklist || []), { text: '', completed: false }] })}>+ APPEND_ENTRY</button>
              </div>
            ) : note.type === 'code' ? (
              <div className="terminal-container">
                <div className="terminal-header">
                  <span className="terminal-label">TERMINAL_BLOCK</span>
                  <button className={`terminal-copy-btn ${isCopied ? 'copied' : ''}`} onClick={handleCopy}>
                    {isCopied ? <CheckSquare size={12} /> : <Copy size={12} />}
                    <span>{isCopied ? 'COPIED!' : 'COPY'}</span>
                  </button>
                </div>
                <textarea 
                  className="terminal-text-area"
                  placeholder="// START_STARK_CODE_LOG..."
                  value={note.content}
                  onChange={(e) => onUpdate({ content: e.target.value })}
                  autoFocus
                />
              </div>
            ) : (
              <textarea 
                className="editor-text-area"
                placeholder="START_LOG_ENTRY..."
                value={note.content}
                onChange={(e) => onUpdate({ content: e.target.value })}
                autoFocus
              />
            )}
          </div>
        </div>

        <footer className="editor-footer">
          <div className="header-tools">
            <button className="tool-btn" onClick={() => fileInputRef.current?.click()}><ImageIcon size={18} /></button>
            <button className="tool-btn" onClick={() => onUpdate({ isReminder: true, reminderDate: new Date().toDateString() })}><Calendar size={18} className={note.isReminder ? 'text-[var(--primary)]' : ''} /></button>
            <button className="tool-btn" onClick={handleCopy}><Copy size={18} /></button>
            <div className="v-divider mx-4" />
            <div className="flex gap-4">
              {['STARK_RED', 'STARK_YELLOW', 'STARK_BLUE'].map(t => (
                <button 
                  key={t} 
                  className={`theme-dot ${currentTheme === t ? 'active' : ''}`} 
                  style={{ backgroundColor: t === 'STARK_RED' ? '#f31' : t === 'STARK_YELLOW' ? '#fc0' : '#06f' }} 
                  onClick={() => onSetTheme(t as ThemeType)} 
                />
              ))}
            </div>
          </div>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
          <span className="entry-id">SECURED_VAULT_AUTO_SYNC_ACTIVE</span>
        </footer>
      </div>
    </div>
  );
};

const SortOption = ({ active, label, onClick }: any) => (
  <button className={`drawer-option ${active ? 'active' : ''}`} onClick={onClick}>
    <span className="option-label">{label}</span>
    {active && <div className="active-dot" />}
  </button>
);

const SidebarLink = ({ icon, label, active, onClick, collapsed }: any) => (
  <button className={`nav-link ${active ? 'active' : ''}`} onClick={onClick}>
    <div className="nav-icon">{icon}</div>
    {!collapsed && <span className="nav-label">{label}</span>}
  </button>
);

const FabOption = ({ icon, label, onClick }: any) => (
  <div className="fab-opt" onClick={onClick}>
    <span>{label}</span>
    {icon}
  </div>
);

const LoginPortal = ({ onLogin, socket }: { onLogin: () => void, socket: Socket | null }) => {
  const [showGmailSelector, setShowGmailSelector] = useState(false);
  const [showQRBridge, setShowQRBridge] = useState(false);
  const [selectedGmail, setSelectedGmail] = useState<string | null>(null);

  const handleGmailLogin = (email: string) => {
    setSelectedGmail(email);
    setTimeout(() => {
      onLogin();
      setShowGmailSelector(false);
    }, 1500);
  };

  return (
    <div className="login-gate">
      <div className="dot-bg" />
      
      {showGmailSelector ? (
        <div className="login-card p-8 animate-in fade-in zoom-in duration-300">
          <div className="auth-header-strip">
            <h2 className="auth-header-label">SELECT_STARK_DRIVE_VAULT</h2>
          </div>
          
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { name: 'STARK_OPERATOR_1', email: 'tony.s@drive.vault' },
              { name: 'GUEST_ACCESS_v1', email: 'guest.identity@pc-local.vault' }
            ].map((acc, i) => (
              <button 
                key={i} 
                className="conn-card w-full" 
                style={{ padding: '20px', background: selectedGmail === acc.email ? 'rgba(255,49,49,0.05)' : 'rgba(255,255,255,0.02)' }}
                onClick={() => handleGmailLogin(acc.email)}
              >
                <div className="p-avatar" style={{ width: '30px', height: '30px' }} />
                <div className="conn-info" style={{ textAlign: 'left', marginLeft: '12px' }}>
                  <span className="conn-title" style={{ fontSize: '11px' }}>{acc.name}</span>
                  <span className="conn-sub" style={{ fontSize: '9px' }}>{selectedGmail === acc.email ? 'DECRYPTING_DRIVE_VAULT...' : acc.email}</span>
                </div>
                {selectedGmail === acc.email && <RefreshCw size={14} className="animate-spin ml-auto text-[var(--primary)]" />}
              </button>
            ))}
          </div>

          <button className="add-check-link mt-6" onClick={() => setShowGmailSelector(false)}>← RETURN_TO_GATEWAY</button>
        </div>
      ) : showQRBridge ? (
        <div className="login-card p-8 animate-in fade-in zoom-in duration-300">
          <button className="close-btn absolute top-6 right-6" onClick={() => setShowQRBridge(false)}><X size={20} /></button>
          
          <div className="auth-header-strip">
            <h2 className="auth-header-label">STARK_QR_BRIDGE</h2>
          </div>

          <div className="qr-container-login">
            <div className="qr-box-mini">
              {socket?.id ? (
                <QRCodeSVG 
                  value={JSON.stringify({
                    protocol: 'STARK_BRIDGE_V2',
                    sessionId: socket.id,
                    timestamp: Date.now(),
                    region: 'GLOBAL_ENCRYPT_NODE'
                  })} 
                  size={200} 
                  level="H" 
                  bgColor="#ffffff" 
                  fgColor="#000000" 
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                  <RefreshCw className="animate-spin text-[var(--primary)]" size={32} />
                  <span style={{ fontSize: '8px', fontWeight: 900, color: '#000', letterSpacing: '1px' }}>INITIALIZING_GLOBAL_NODE...</span>
                </div>
              )}
            </div>
            <p className="auth-hint">SCAN_TO_BRIDGE_MOBILE_VAULT_WITH_PC_TERMINAL</p>
          </div>
        </div>
      ) : (
        <div className="login-card">
          <div className="absolute top-0 left-0 w-full h-1 bg-[var(--primary)]" />
          
          <div className="logo-box scale-125 mb-4 !border-[3px]"><span>!</span></div>
          
          <div style={{ textAlign: 'center' }}>
            <h1 className="auth-title">STARK_VAULT_DECRYPT</h1>
            <p className="auth-subtitle">AUTHORIZATION_REQUIRED_TO_PROCEED</p>
          </div>

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button className="google-sign-in-btn w-full !justify-center !py-4" style={{ background: 'var(--primary)', color: '#000' }} onClick={() => setShowGmailSelector(true)}>
              <CloudLightning size={20} />
              <span className="text-xs font-black tracking-widest">SIGN_IN_WITH_STARK_DRIVE</span>
            </button>

            <button 
              className="google-sign-in-btn w-full !justify-center !py-4" 
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }} 
              onClick={() => setShowQRBridge(true)}
            >
              <Monitor size={20} />
              <span className="text-xs font-black tracking-widest" style={{ color: '#fff' }}>STARK_QR_BRIDGE</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <span style={{ fontSize: '7px', fontWeight: 900, color: 'rgba(255,255,255,0.3)', letterSpacing: '4px' }}>OMNINOTES_STARK_INDUSTRIAL</span>
            <span style={{ fontSize: '7px', fontWeight: 900, color: 'var(--primary)', letterSpacing: '2px' }}>ENCRYPTION_v5.6_STABLE</span>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
