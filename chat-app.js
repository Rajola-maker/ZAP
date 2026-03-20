// chat-app.js - Complete Real-time Chat Application
import { 
    auth, db, googleProvider, signInWithPopup, onAuthStateChanged, signOut,
    collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, 
    updateDoc, setDoc, serverTimestamp, getDocs, arrayUnion, arrayRemove
} from './firebase-config.js';

// ================= DOM Elements =================
const loginOverlay = document.getElementById('loginOverlay');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const sidebar = document.getElementById('sidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const usersList = document.getElementById('usersList');
const searchUsers = document.getElementById('searchUsers');
const chatHeader = document.getElementById('chatHeader');
const messagesArea = document.getElementById('messagesArea');
const inputArea = document.getElementById('inputArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const loading = document.getElementById('loading');
const toastContainer = document.getElementById('toastContainer');

// ================= State Management =================
let currentUser = null;
let selectedUser = null;
let selectedChatId = null;
let messagesUnsubscribe = null;
let allUsers = [];
let onlineUsers = new Set();

// ================= Helper Functions =================
function showToast(message, type = 'info') {
    toastContainer.textContent = message;
    toastContainer.className = `toast ${type}`;
    toastContainer.classList.add('show');
    setTimeout(() => {
        toastContainer.classList.remove('show');
    }, 3000);
}

function showLoading(show) {
    if (show) {
        loading.classList.add('active');
    } else {
        loading.classList.remove('active');
    }
}

function formatTime(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

function formatDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    }
}

// ================= Authentication =================
async function handleGoogleLogin() {
    try {
        showLoading(true);
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        
        // Save user to Firestore
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                status: 'online',
                lastSeen: serverTimestamp(),
                createdAt: serverTimestamp()
            });
        } else {
            await updateDoc(userRef, {
                status: 'online',
                lastSeen: serverTimestamp()
            });
        }
        
        // Set up presence
        setupPresence(user.uid);
        
        showToast('Login successful!', 'success');
        
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function setupPresence(uid) {
    const userRef = doc(db, 'users', uid);
    
    // Set online on connection
    updateDoc(userRef, { status: 'online', lastSeen: serverTimestamp() });
    
    // Set offline on disconnect
    window.addEventListener('beforeunload', () => {
        updateDoc(userRef, { status: 'offline', lastSeen: serverTimestamp() });
    });
    
    // Update status when page becomes visible/hidden
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateDoc(userRef, { status: 'online', lastSeen: serverTimestamp() });
        } else {
            updateDoc(userRef, { status: 'away', lastSeen: serverTimestamp() });
        }
    });
}

// ================= Load Users =================
function loadUsers() {
    const usersRef = collection(db, 'users');
    const q = query(usersRef);
    
    onSnapshot(q, (snapshot) => {
        const users = [];
        snapshot.forEach((doc) => {
            if (doc.id !== currentUser?.uid) {
                users.push({ id: doc.id, ...doc.data() });
            }
        });
        allUsers = users;
        renderUsersList(users);
    });
}

function renderUsersList(users) {
    if (!usersList) return;
    
    const searchTerm = searchUsers?.value.toLowerCase() || '';
    const filteredUsers = users.filter(user => 
        user.displayName?.toLowerCase().includes(searchTerm)
    );
    
    if (filteredUsers.length === 0) {
        usersList.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">No users found</div>';
        return;
    }
    
    usersList.innerHTML = '';
    filteredUsers.forEach(user => {
        const isOnline = user.status === 'online';
        const userEl = document.createElement('div');
        userEl.className = `user-item ${selectedUser?.id === user.id ? 'active' : ''}`;
        userEl.onclick = () => selectUser(user);
        userEl.innerHTML = `
            <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName)}" 
                 class="user-avatar-small">
            <div class="user-details">
                <div class="user-name">${user.displayName}</div>
                <div class="user-status ${isOnline ? 'online' : ''}">
                    ${isOnline ? '<span class="online-indicator"></span> Online' : 'Offline'}
                </div>
            </div>
        `;
        usersList.appendChild(userEl);
    });
}

// ================= Select User & Start Chat =================
async function selectUser(user) {
    selectedUser = user;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const selectedEl = Array.from(document.querySelectorAll('.user-item')).find(
        el => el.querySelector('.user-name')?.textContent === user.displayName
    );
    if (selectedEl) selectedEl.classList.add('active');
    
    // Update chat header
    chatHeader.innerHTML = `
        <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName)}" 
             class="chat-user-avatar">
        <div class="chat-user-info">
            <h3>${user.displayName}</h3>
            <div class="chat-user-status ${user.status === 'online' ? 'online' : ''}">
                ${user.status === 'online' ? '<span class="online-indicator"></span> Online' : 'Last seen recently'}
            </div>
        </div>
    `;
    
    // Show input area
    inputArea.style.display = 'flex';
    
    // Get or create chat
    await getOrCreateChat(user.id);
    
    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    }
}

async function getOrCreateChat(otherUserId) {
    if (!currentUser) return;
    
    // Check if chat already exists
    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid));
    const snapshot = await getDocs(q);
    
    let existingChat = null;
    snapshot.forEach((doc) => {
        const chat = doc.data();
        if (chat.participants.includes(otherUserId)) {
            existingChat = doc.id;
        }
    });
    
    if (existingChat) {
        selectedChatId = existingChat;
        loadMessages(existingChat);
        return existingChat;
    }
    
    // Create new chat
    const newChatRef = await addDoc(collection(db, 'chats'), {
        participants: [currentUser.uid, otherUserId],
        createdAt: serverTimestamp(),
        lastMessage: null,
        lastMessageTime: serverTimestamp()
    });
    
    selectedChatId = newChatRef.id;
    loadMessages(newChatRef.id);
    return newChatRef.id;
}

// ================= Load Messages =================
function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        const messages = [];
        snapshot.forEach((doc) => {
            messages.push({ id: doc.id, ...doc.data() });
        });
        renderMessages(messages);
    });
}

function renderMessages(messages) {
    if (!messagesArea) return;
    
    if (messages.length === 0) {
        messagesArea.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comment-dots"></i>
                <h3>No messages yet</h3>
                <p>Send a message to start the conversation</p>
            </div>
        `;
        return;
    }
    
    let lastDate = null;
    messagesArea.innerHTML = '';
    
    messages.forEach((message) => {
        const messageDate = message.timestamp?.toDate();
        const messageDay = messageDate?.toDateString();
        
        // Add date separator
        if (messageDay && messageDay !== lastDate) {
            const dateSeparator = document.createElement('div');
            dateSeparator.className = 'date-separator';
            dateSeparator.innerHTML = `<span>${formatDate(messageDate)}</span>`;
            messagesArea.appendChild(dateSeparator);
            lastDate = messageDay;
        }
        
        const isSent = message.senderId === currentUser.uid;
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        messageEl.innerHTML = `
            <div class="message-content">${message.content}</div>
            <div class="message-info">
                <span class="message-time">${formatTime(messageDate)}</span>
                ${isSent ? `<span class="message-status ${message.status === 'read' ? 'read' : ''}">
                    ${message.status === 'read' ? '✓✓' : '✓'}
                </span>` : ''}
            </div>
        `;
        messagesArea.appendChild(messageEl);
    });
    
    // Scroll to bottom
    messagesArea.scrollTop = messagesArea.scrollHeight;
    
    // Mark messages as read if they're from other user
    if (selectedChatId) {
        markMessagesAsRead();
    }
}

async function markMessagesAsRead() {
    const messagesRef = collection(db, 'chats', selectedChatId, 'messages');
    const q = query(messagesRef, where('senderId', '==', selectedUser.id), where('status', '==', 'delivered'));
    const snapshot = await getDocs(q);
    
    snapshot.forEach(async (doc) => {
        await updateDoc(doc.ref, { status: 'read' });
    });
}

// ================= Send Message =================
async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !selectedChatId || !currentUser) return;
    
    const message = {
        senderId: currentUser.uid,
        content: content,
        timestamp: serverTimestamp(),
        status: 'sent'
    };
    
    try {
        await addDoc(collection(db, 'chats', selectedChatId, 'messages'), message);
        
        // Update chat last message
        await updateDoc(doc(db, 'chats', selectedChatId), {
            lastMessage: { content, timestamp: serverTimestamp() },
            lastMessageTime: serverTimestamp()
        });
        
        messageInput.value = '';
        
        // Update status to delivered (will be updated to read when seen)
        setTimeout(async () => {
            const lastMessageRef = doc(db, 'chats', selectedChatId, 'messages', message.id);
            await updateDoc(lastMessageRef, { status: 'delivered' });
        }, 1000);
        
    } catch (error) {
        console.error('Send message error:', error);
        showToast('Failed to send message', 'error');
    }
}

// ================= Search Users =================
if (searchUsers) {
    searchUsers.addEventListener('input', () => {
        renderUsersList(allUsers);
    });
}

// ================= Mobile Menu =================
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
}

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    }
});

// ================= Send on Enter =================
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// ================= Auth State Listener =================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL
        };
        
        // Update UI
        userAvatar.src = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName);
        userName.textContent = user.displayName;
        userEmail.textContent = user.email;
        
        loginOverlay.style.display = 'none';
        
        // Load users
        loadUsers();
        
        showToast(`Welcome, ${user.displayName}!`, 'success');
        
    } else {
        // Show login
        loginOverlay.style.display = 'flex';
        currentUser = null;
        selectedUser = null;
        selectedChatId = null;
        if (messagesUnsubscribe) messagesUnsubscribe();
    }
});

// ================= Logout Function (for future use) =================
window.logout = async function() {
    try {
        if (currentUser) {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                status: 'offline',
                lastSeen: serverTimestamp()
            });
        }
        await signOut(auth);
        showToast('Logged out successfully', 'success');
    } catch (error) {
        console.error('Logout error:', error);
    }
};

// ================= Google Login Button =================
googleLoginBtn.addEventListener('click', handleGoogleLogin);

console.log('✅ Chat app initialized');
