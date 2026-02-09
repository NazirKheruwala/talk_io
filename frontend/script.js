// Talkio Outcomes Engine - Firebase Spark Migration
import { auth, db, rtdb } from "./firebase-client-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  ref,
  set,
  onValue,
  onDisconnect,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// =====================
// GLOBAL STATE
// =====================
const AppState = {
  auth: {
    isResolved: false,
    isAuthenticated: false,
    user: null, // { uid, username, email }
  },
  conversation: {
    current: null,
    list: [],
    memberships: {}, // Store userId_groupId: status
  },
  intent: {
    selected: null,
    timeLimit: null,
  },
  listeners: new Map(), // Global unsubscribe store
};

// =====================
// DOM ELEMENTS
// =====================
const authModal = document.getElementById("authModal");
const intentModal = document.getElementById("intentModal");
const appContainer = document.getElementById("appContainer");
const loadingOverlay = createLoadingOverlay();
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authTabs = document.querySelectorAll(".auth-tab");
const authError = document.getElementById("authError");
const logoutBtn = document.getElementById("logoutBtn");
const userNameDisplay = document.getElementById("userName");
const userAvatar = document.getElementById("userAvatar");

// Intent Modal
const intentGrid = document.getElementById("intentGrid");
const enableTimeLimit = document.getElementById("enableTimeLimit");
const timeOptions = document.getElementById("timeOptions");
const cancelIntent = document.getElementById("cancelIntent");
const startConversation = document.getElementById("startConversation");

// Chat Elements
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messagesArea = document.getElementById("messagesArea");
const welcomeState = document.getElementById("welcomeState");
const chatTitle = document.getElementById("chatTitle");
const intentBadge = document.getElementById("intentBadge");
const conversationTimer = document.getElementById("conversationTimer");
const timerText = document.getElementById("timerText");
const statusIndicator = document.getElementById("statusIndicator");
const typingIndicator = document.getElementById("typingIndicator");
const typingText = document.getElementById("typingText");
const momentumMeter = document.getElementById("momentumMeter");
const momentumValue = document.getElementById("momentumValue");
const momentumBar = document.getElementById("momentumBar");
const momentumNote = document.getElementById("momentumNote");

// Outcome Panel
const outcomePanel = document.getElementById("outcomePanel");
const toggleOutcomePanel = document.getElementById("toggleOutcomePanel");
const closeOutcomePanel = document.getElementById("closeOutcomePanel");
const outcomeSummary = document.getElementById("outcomeSummary");
const decisionsList = document.getElementById("decisionsList");
const actionsList = document.getElementById("actionsList");
const addDecision = document.getElementById("addDecision");
const addAction = document.getElementById("addAction");


// Modals
const addDecisionModal = document.getElementById("addDecisionModal");
const addActionModal = document.getElementById("addActionModal");

// View Toggle
const viewBtns = document.querySelectorAll(".view-btn");
const chatView = document.getElementById("chatView");
const dashboardView = document.getElementById("dashboardView");
const conversationsList = document.getElementById("conversationsList");
const createConversationBtn = document.getElementById("createConversationBtn");

// AI Hint
const aiHint = document.getElementById("aiHint");
const aiHintText = document.getElementById("aiHintText");
const aiHintAction = document.getElementById("aiHintAction");
const aiHintDismiss = document.getElementById("aiHintDismiss");

// Dashboard
const activeCount = document.getElementById("activeCount");
const closingCount = document.getElementById("closingCount");
const completedCount = document.getElementById("completedCount");
const activeConversations = document.getElementById("activeConversations");
const closingConversations = document.getElementById("closingConversations");
const completedOutcomes = document.getElementById("completedOutcomes");

// =====================
// CONSTANTS
// =====================
const INTENTS = {
  decision: { icon: "📋", label: "Decision", color: "#0A84FF" },
  brainstorm: { icon: "💡", label: "Brainstorm", color: "#FF9500" },
  support: { icon: "🤝", label: "Support", color: "#34C759" },
  learning: { icon: "📚", label: "Learning", color: "#AF52DE" },
  planning: { icon: "📅", label: "Planning", color: "#FF3B30" }
};

const AI_PATTERNS = {
  decision: [/we decided/i, /let's go with/i, /agreed to/i, /the decision is/i, /we'll do/i],
  action: [/i will/i, /action item/i, /todo:/i, /need to/i, /should be done/i, /by tomorrow/i]
};

let typingTimeout = null;

// =====================
// LOADING OVERLAY (Auth Resolution Gate)
// =====================
function createLoadingOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "loadingOverlay";
  overlay.innerHTML = `
    <div style="text-align: center; color: #1D1D1F;">
      <div style="width: 48px; height: 48px; border: 3px solid #E5E5EA; border-top-color: #0A84FF; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
      <p style="font-size: 15px; font-weight: 500;">Loading Talkio...</p>
    </div>
  `;
  overlay.style.cssText = `
    position: fixed; inset: 0; background: #FAFAFA;
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  const style = document.createElement("style");
  style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return overlay;
}

// =====================
// APP INITIALIZATION
// =====================
initializeApp();

async function initializeApp() {
  showLoading();

  initializeAuthUI();
  initializeIntentModal();
  initializeChatUI();
  initializeOutcomePanel();
  initializeViewToggle();
  initializeAIHints();
  initializeMobileNavigation();

  // Initialize Auth gate
  setupAuthListener();
}

// =====================
// PRESENCE & CLEANUP
// =====================
function initializePresence(uid) {
  const userPresenceRef = ref(rtdb, `presence/${uid}`);
  const isOfflineForRTDB = {
    isOnline: false,
    lastChanged: rtdbTimestamp(),
  };
  const isOnlineForRTDB = {
    isOnline: true,
    lastChanged: rtdbTimestamp(),
  };

  // The .info/connected path is a special path that returns true when the client is connected
  onValue(ref(rtdb, ".info/connected"), (snapshot) => {
    if (snapshot.val() === false) return;

    onDisconnect(userPresenceRef).set(isOfflineForRTDB).then(() => {
      set(userPresenceRef, isOnlineForRTDB);
    });
  });
}

function cleanupAllListeners() {
  console.log("Cleaning up all Firestore listeners...");
  AppState.listeners.forEach((unsubscribe, id) => {
    unsubscribe();
    AppState.listeners.delete(id);
  });
}

function registerListener(id, unsubscribe) {
  if (AppState.listeners.has(id)) {
    AppState.listeners.get(id)();
  }
  AppState.listeners.set(id, unsubscribe);
}

// =====================
// CORE SYNCING
// =====================
function startSyncingConversations() {
  // Sync all groups (Basic discovery)
  const groupsQuery = query(collection(db, "groups"), orderBy("createdAt", "desc"));
  const unsubGroups = onSnapshot(groupsQuery, (snapshot) => {
    AppState.conversation.list = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    renderConversationsList();
    renderDashboard();
  });
  registerListener("groupList", unsubGroups);

  // New: Sync my memberships for performance
  if (AppState.auth.user) {
    const membershipsQuery = query(
      collection(db, "memberships"),
      where("userId", "==", AppState.auth.user.uid)
    );
    const unsubMemberships = onSnapshot(membershipsQuery, (snapshot) => {
      AppState.conversation.memberships = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        AppState.conversation.memberships[data.groupId] = data.status;
      });
      renderConversationsList();
    });
    registerListener("userMemberships", unsubMemberships);
  }
}

// =====================
// AUTH RESOLUTION (FIREBASE)
// =====================
function setupAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("Firebase Auth state changed: logged in", user.uid);

      // Fetch user profile from Firestore
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const userData = userDoc.data();

      AppState.auth.isResolved = true;
      AppState.auth.isAuthenticated = true;
      AppState.auth.user = {
        uid: user.uid,
        username: userData?.username || user.email.split("@")[0],
        email: user.email,
      };

      hideLoading();
      showApp();
      initializePresence(user.uid);
      startSyncingConversations();
    } else {
      console.log("Firebase Auth state changed: logged out");
      AppState.auth.isResolved = true;
      AppState.auth.isAuthenticated = false;
      AppState.auth.user = null;
      cleanupAllListeners();
      hideLoading();
      showAuthModal();
    }
  });
}

async function handleLogin(e) {
  e.preventDefault();
  clearAuthError();

  const email = document.getElementById("loginEmailOrUsername").value.trim(); // Assume email for simplicity in FB
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) return;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the UI update
  } catch (error) {
    showAuthError("Login failed: " + error.message);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  clearAuthError();

  const username = document.getElementById("signupUsername").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!username || !email || !password) return;

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Create user document in Firestore
    await setDoc(doc(db, "users", user.uid), {
      username: username,
      email: email,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });

    // onAuthStateChanged handles the rest
  } catch (error) {
    showAuthError("Signup failed: " + error.message);
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    // onAuthStateChanged handles the cleanup
  } catch (error) {
    console.error("Logout error", error);
  }
}

// =====================
// AUTH UI (LOGIN/SIGNUP ONLY)
// =====================
function initializeAuthUI() {
  authTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      authTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      if (targetTab === "login") {
        loginForm.style.display = "flex";
        signupForm.style.display = "none";
      } else {
        loginForm.style.display = "none";
        signupForm.style.display = "flex";
      }
      clearAuthError();
    });
  });

  loginForm.addEventListener("submit", handleLogin);
  signupForm.addEventListener("submit", handleSignup);
  logoutBtn.addEventListener("click", handleLogout);
}

function showLoading() {
  loadingOverlay.style.display = "flex";
  authModal.style.display = "none";
  appContainer.style.display = "none";
}

function hideLoading() {
  loadingOverlay.style.display = "none";
}

function showAuthModal() {
  authModal.style.display = "flex";
  appContainer.style.display = "none";
}

function showApp() {
  authModal.style.display = "none";
  appContainer.style.display = "flex";

  // Update user display from trusted state
  if (AppState.auth.user) {
    userNameDisplay.textContent = AppState.auth.user.username;
    userAvatar.textContent = getInitials(AppState.auth.user.username);
  }

  // Update chat UI based on conversation state
  updateChatUI();
}

function showAuthError(message) {
  authError.textContent = message;
  authError.style.display = "block";
}

function clearAuthError() {
  authError.textContent = "";
  authError.style.display = "none";
}

// Socket initialization removed - moved to setupAuthListener

// =====================
// INTENT MODAL
// =====================
function initializeIntentModal() {
  intentGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".intent-card");
    if (!card) return;

    document.querySelectorAll(".intent-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    AppState.intent.selected = card.dataset.intent;
    startConversation.disabled = false;
  });

  enableTimeLimit.addEventListener("change", () => {
    timeOptions.style.display = enableTimeLimit.checked ? "flex" : "none";
    if (!enableTimeLimit.checked) {
      AppState.intent.timeLimit = null;
      document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("selected"));
    }
  });

  document.querySelectorAll(".time-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      AppState.intent.timeLimit = btn.dataset.hours;
    });
  });

  cancelIntent.addEventListener("click", () => {
    intentModal.style.display = "none";
    resetIntentModal();
  });

  startConversation.addEventListener("click", createNewConversation);

  createConversationBtn.addEventListener("click", () => {
    intentModal.style.display = "flex";
  });
}

function resetIntentModal() {
  AppState.intent.selected = null;
  AppState.intent.timeLimit = null;
  document.querySelectorAll(".intent-card").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("selected"));
  enableTimeLimit.checked = false;
  timeOptions.style.display = "none";
  startConversation.disabled = true;
}

async function createNewConversation() {
  const intent = INTENTS[AppState.intent.selected];
  if (!intent || !AppState.auth.user) return;

  const expiresHours = AppState.intent.timeLimit ? parseInt(AppState.intent.timeLimit) : null;
  const expiresAt = expiresHours ? Date.now() + (expiresHours * 3600000) : null;

  try {
    // 1. Create the group document
    const groupRef = await addDoc(collection(db, "groups"), {
      intent: AppState.intent.selected,
      status: "active",
      createdAt: serverTimestamp(),
      creatorId: AppState.auth.user.uid,
      expiresAt: expiresAt,
      name: `${intent.label} - ${formatDate(new Date())}`,
    });

    // 2. Create the creator's membership (auto-accepted as admin)
    // In production, security rules would allow this or a trigger would handle it.
    // For this migration, we set it directly; rules will validate creator match.
    await setDoc(doc(db, "memberships", `${groupRef.id}_${AppState.auth.user.uid}`), {
      groupId: groupRef.id,
      userId: AppState.auth.user.uid,
      status: "accepted",
      role: "admin",
      createdAt: serverTimestamp()
    });

    intentModal.style.display = "none";
    resetIntentModal();

    // UI will update automatically via startSyncingConversations listener
    showToast("Conversation created!", "success");
    selectConversation(groupRef.id);
  } catch (error) {
    showToast("Failed to create conversation: " + error.message, "error");
  }
}

// =====================
// CHAT UI
// =====================
function initializeChatUI() {
  chatForm.addEventListener("submit", handleSendMessage);

  messageInput.addEventListener("input", () => {
    // Enable send only if there's text AND a conversation is selected
    const hasText = messageInput.value.trim().length > 0;
    const hasConversation = AppState.conversation.current !== null;
    sendButton.disabled = !hasText || !hasConversation;

    if (hasConversation) {
      handleTyping();
    }
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !sendButton.disabled) {
      e.preventDefault();
      handleSendMessage(e);
    }
  });

  messageInput.addEventListener("blur", () => {
    // Typing indicators via RTDB could be added here later
    clearTypingTimeout();
  });

  // Focus behavior
  messageInput.addEventListener("focus", () => {
    if (!AppState.conversation.current) {
      // Just show helper, no error
      messageInput.placeholder = "Select or create a conversation first";
    } else {
      messageInput.placeholder = "Type a message...";
    }
  });

  const voiceNoteBtn = document.getElementById("voiceNoteBtn");
  if (voiceNoteBtn) {
    voiceNoteBtn.addEventListener("click", () => showToast("Voice Notes coming soon!", "info"));
  }
}

async function handleSendMessage(e) {
  e.preventDefault();

  if (!AppState.conversation.current) {
    showToast("Select or create a conversation first", "info");
    return;
  }

  const message = messageInput.value.trim();
  if (!message) return;

  try {
    await addDoc(collection(db, "messages"), {
      groupId: AppState.conversation.current.id,
      senderId: AppState.auth.user.uid,
      username: AppState.auth.user.username,
      message: message,
      timestamp: serverTimestamp()
    });

    messageInput.value = "";
    sendButton.disabled = true;
    clearTypingTimeout();
    detectAIPatterns(message);
  } catch (error) {
    showToast("Failed to send message: " + error.message, "error");
  }
}

function handleTyping() {
  // RTDB typing hooks could be implemented here
}

function clearTypingTimeout() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}

// =====================
// CHAT UI UPDATE (Based on State)
// =====================
function updateChatUI() {
  if (!AppState.conversation.current) {
    // No conversation selected - show helpful state
    welcomeState.style.display = "flex";
    welcomeState.innerHTML = `
      <div class="welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </div>
      <h3>Welcome to Talkio</h3>
      <p>Create a conversation to get started</p>
      <button class="btn btn-primary" onclick="document.getElementById('createConversationBtn').click()">New Conversation</button>
    `;
    intentBadge.parentElement.style.visibility = "hidden";
    if (momentumMeter) {
      momentumMeter.style.visibility = "hidden";
    }
    messageInput.placeholder = "Select a conversation to start messaging";
    messageInput.disabled = true;
    sendButton.disabled = true;
    return;
  }

  // Conversation selected - enable messaging
  welcomeState.style.display = "none";
  messageInput.disabled = false;
  messageInput.placeholder = "Type a message...";
  intentBadge.parentElement.style.visibility = "visible";
  if (momentumMeter) {
    momentumMeter.style.visibility = "visible";
  }

  const intent = INTENTS[AppState.conversation.current.intent];
  document.querySelector(".intent-badge-icon").textContent = intent.icon;
  document.querySelector(".intent-badge-text").textContent = intent.label;
  chatTitle.textContent = AppState.conversation.current.name;

  // Update status
  const statusDot = statusIndicator.querySelector(".status-dot");
  const statusTextEl = statusIndicator.querySelector(".status-text");
  statusDot.className = `status-dot ${AppState.conversation.current.status}`;
  statusTextEl.textContent = AppState.conversation.current.status.charAt(0).toUpperCase() + AppState.conversation.current.status.slice(1);

  // Timer
  if (AppState.conversation.current.expiresAt) {
    conversationTimer.style.display = "flex";
    updateTimer();
  } else {
    conversationTimer.style.display = "none";
  }

  // Update outcome panel
  updateOutcomePanel();

  // Request messages via Firestore sync
  const messagesQuery = query(
    collection(db, "messages"),
    where("groupId", "==", AppState.conversation.current.id),
    orderBy("timestamp", "asc"),
    limit(100)
  );

  const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: (data.timestamp && typeof data.timestamp.toDate === 'function')
          ? data.timestamp.toDate()
          : (data.timestamp || new Date())
      };
    }).sort((a, b) => a.timestamp - b.timestamp);

    renderMessages(messages);
  }, (error) => {
    showToast("Failed to sync messages: " + error.message, "error");
    console.error("Messages sync error:", error);
  });

  registerListener("chatMessages", unsubMessages);
}

function updateTimer() {
  if (!AppState.conversation.current?.expiresAt) return;

  const remaining = AppState.conversation.current.expiresAt - Date.now();
  if (remaining <= 0) {
    timerText.textContent = "Expired";
    AppState.conversation.current.status = "closing";
    updateChatUI();
    return;
  }

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  timerText.textContent = `${hours}h ${minutes}m`;
}

// =====================
// CONVERSATION LIST
// =====================
async function selectConversation(id) {
  const conv = AppState.conversation.list.find(c => c.id === id);
  if (!conv || !AppState.auth.user) return;

  // Check membership status
  const membershipId = `${id}_${AppState.auth.user.uid}`;
  const membershipDoc = await getDoc(doc(db, "memberships", membershipId));

  if (!membershipDoc.exists()) {
    // Show Join Request UI or Auto-request? 
    // Plan: Show a toast and create a pending request if they click a "Join" button (implied by selection for now)
    if (confirm(`Would you like to join "${conv.name}"?`)) {
      try {
        await setDoc(doc(db, "memberships", membershipId), {
          groupId: id,
          userId: AppState.auth.user.uid,
          status: "pending",
          role: "member",
          createdAt: serverTimestamp()
        });
        showToast("Join request sent! Wait for approval.", "info");
      } catch (error) {
        showToast("Failed to request join: " + error.message, "error");
      }
    }
    return;
  }

  const membership = membershipDoc.data();
  if (membership.status !== "accepted") {
    showToast(`Access denied. Status: ${membership.status}`, "warning");
    return;
  }

  AppState.conversation.current = conv;
  updateChatUI();
  renderConversationsList();
  switchView("chats");
}

function renderConversationsList() {
  conversationsList.innerHTML = "";

  if (AppState.conversation.list.length === 0) {
    conversationsList.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-secondary);">
        <p>No conversations yet</p>
        <button class="btn btn-primary" style="margin-top: 12px;" onclick="document.getElementById('createConversationBtn').click()">Create First Conversation</button>
      </div>
    `;
    return;
  }

  AppState.conversation.list.forEach(conv => {
    const intent = INTENTS[conv.intent];
    const membershipStatus = AppState.conversation.memberships[conv.id] || "none";

    const item = document.createElement("div");
    item.className = `conversation-item ${conv.id === AppState.conversation.current?.id ? "active" : ""}`;
    item.innerHTML = `
      <span class="conv-intent-icon">${intent.icon}</span>
      <div class="conv-details">
        <span class="conv-name">${escapeHtml(conv.name)}</span>
        <span class="conv-preview">${membershipStatus === "accepted" ? intent.label : `Status: ${membershipStatus}`}</span>
      </div>
      <div class="conv-meta">
        <span class="conv-time">${formatTime(conv.createdAt?.toDate ? conv.createdAt.toDate() : conv.createdAt)}</span>
        <span class="conv-status ${conv.status}">${conv.status}</span>
      </div>
    `;

    item.addEventListener("click", () => selectConversation(conv.id));
    conversationsList.appendChild(item);
  });
}

// =====================
// MESSAGE RENDERING
// =====================
function renderMessages(messages) {
  const existingMessages = messagesArea.querySelectorAll(".message-group, .system-message");
  existingMessages.forEach(m => m.remove());

  if (!messages || messages.length === 0) {
    welcomeState.style.display = "flex";
    welcomeState.innerHTML = `
      <div class="welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </div>
      <h3>Conversation Started</h3>
      <p>Send the first message to summarize decisions.</p>
    `;
    return;
  }

  welcomeState.style.display = "none";

  // Group messages
  const grouped = [];
  let currentGroup = null;

  messages.forEach(item => {
    if (item.type === "system") {
      if (currentGroup) {
        grouped.push(currentGroup);
        currentGroup = null;
      }
      grouped.push({ type: "system", item });
    } else {
      const isSelf = item.username === AppState.auth.user?.username;
      const sameUser = currentGroup &&
        currentGroup.type === "user" &&
        currentGroup.username === item.username &&
        currentGroup.isSelf === isSelf;

      if (sameUser) {
        currentGroup.messages.push(item);
      } else {
        if (currentGroup) grouped.push(currentGroup);
        currentGroup = {
          type: "user",
          username: item.username,
          isSelf,
          messages: [item]
        };
      }
    }
  });

  if (currentGroup) grouped.push(currentGroup);

  grouped.forEach(group => {
    if (group.type === "system") {
      renderSystemMessage(group.item);
    } else {
      renderMessageGroup(group);
    }
  });

  updateOutcomeMomentum(messages);
  scrollToBottom();
}

function renderMessageGroup(group) {
  const { username, isSelf, messages } = group;

  const groupDiv = document.createElement("div");
  groupDiv.className = `message-group ${isSelf ? "self" : "other"}`;

  messages.forEach((item, index) => {
    const isFirst = index === 0;
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isSelf ? "self" : "other"}`;

    const msgText = item.message || item.content || "";

    messageDiv.innerHTML = `
      ${isFirst ? `
        <div class="message-header">
          <span class="message-username">${escapeHtml(username)}</span>
          <span class="message-timestamp">${formatTime(item.timestamp)}</span>
        </div>
      ` : ""}
      <div class="message-bubble">
        <div class="message-content">${escapeHtml(msgText)}</div>
      </div>
    `;

    groupDiv.appendChild(messageDiv);
  });

  messagesArea.appendChild(groupDiv);
}

function renderSystemMessage(item) {
  const systemDiv = document.createElement("div");
  systemDiv.className = "system-message";

  let text = "";
  if (item.event === "conversation-started") {
    text = `Conversation started by <span class="system-username">${escapeHtml(item.username)}</span>`;
  } else if (item.event === "user-joined") {
    text = `<span class="system-username">${escapeHtml(item.username)}</span> joined`;
  } else if (item.event === "user-left") {
    text = `<span class="system-username">${escapeHtml(item.username)}</span> left`;
  }

  systemDiv.innerHTML = text;
  messagesArea.appendChild(systemDiv);
}

function updateOutcomeMomentum(messages) {
  if (!momentumMeter || !momentumValue || !momentumBar || !momentumNote) return;

  const userMessages = (messages || []).filter(msg => msg.type !== "system");
  const total = userMessages.length;

  if (total === 0) {
    momentumValue.textContent = "0%";
    momentumBar.style.width = "0%";
    momentumNote.textContent = "Start messaging to see momentum.";
    return;
  }

  const actionableCount = userMessages.reduce((count, msg) => {
    const text = msg.message || msg.content || "";
    if (!text) return count;
    const isDecision = AI_PATTERNS.decision.some(pattern => pattern.test(text));
    const isAction = AI_PATTERNS.action.some(pattern => pattern.test(text));
    return count + (isDecision || isAction ? 1 : 0);
  }, 0);

  const ratio = actionableCount / total;
  const percent = Math.min(100, Math.round(ratio * 100));
  momentumValue.textContent = `${percent}%`;
  momentumBar.style.width = `${percent}%`;

  if (percent < 15) {
    momentumNote.textContent = "Nudge: capture explicit decisions or next steps.";
  } else if (percent < 35) {
    momentumNote.textContent = "Momentum building—summarize decisions as they happen.";
  } else if (percent < 60) {
    momentumNote.textContent = "Strong momentum. Keep logging outcomes.";
  } else {
    momentumNote.textContent = "Excellent clarity. Outcomes are well captured.";
  }
}

// =====================
// OUTCOME PANEL (FIRESTORE SYNC)
// =====================
async function updateOutcomePanel() {
  if (!AppState.conversation.current) return;

  const groupDocRef = doc(db, "groups", AppState.conversation.current.id);

  // Listen for admin approval requests (If I am the admin)
  if (AppState.conversation.current.creatorId === AppState.auth.user.uid) {
    const pendingQuery = query(
      collection(db, "memberships"),
      where("groupId", "==", AppState.conversation.current.id),
      where("status", "==", "pending")
    );

    const unsubPending = onSnapshot(pendingQuery, (snapshot) => {
      const adminTasksList = document.getElementById("adminTasksList") || createAdminSection();
      const adminSection = document.getElementById("adminTasks");

      if (snapshot.empty) {
        if (adminSection) adminSection.style.display = "none";
        return;
      }

      if (adminSection) adminSection.style.display = "block";
      adminTasksList.innerHTML = "";

      snapshot.docs.forEach(mdoc => {
        const req = mdoc.data();
        const div = document.createElement("div");
        div.className = "outcome-item";
        div.innerHTML = `
            <div style="flex:1; font-size: 13px;">Join request: <b>${req.userId.substring(0, 5)}...</b></div>
            <div class="outcome-item-actions">
              <button class="btn-icon" title="Accept" onclick="handleAcceptJoin('${AppState.conversation.current.id}', '${req.userId}')">✓</button>
              <button class="btn-icon" title="Reject" onclick="handleRejectJoin('${AppState.conversation.current.id}', '${req.userId}')">×</button>
            </div>
          `;
        adminTasksList.appendChild(div);
      });
    });
    registerListener("pendingJoins", unsubPending);
  } else {
    // If not creator, hide admin section
    const adminSection = document.getElementById("adminTasks");
    if (adminSection) adminSection.style.display = "none";
  }

  // Update outcome logic (Persistence in groups document)
  const groupDoc = await getDoc(groupDocRef);
  if (!groupDoc.exists()) return;
  const outcome = groupDoc.data().outcome || { summary: "", decisions: [], actions: [] };

  outcomeSummary.value = outcome.summary || "";
  renderOutcomeItems(outcome, groupDocRef);
}

function createAdminSection() {
  const outcomeContent = document.querySelector(".outcome-content");
  if (!outcomeContent) return null;

  const section = document.createElement("div");
  section.id = "adminTasks";
  section.className = "outcome-section";
  section.innerHTML = `
    <label class="outcome-label">Join Requests</label>
    <div id="adminTasksList" class="outcome-items-container"></div>
  `;

  // Insert at the top of content
  outcomeContent.insertBefore(section, outcomeContent.firstChild);
  return document.getElementById("adminTasksList");
}

async function handleAcceptJoin(groupId, userId) {
  await updateDoc(doc(db, "memberships", `${groupId}_${userId}`), { status: "accepted" });
  showToast("User accepted!", "success");
}

async function handleRejectJoin(groupId, userId) {
  await updateDoc(doc(db, "memberships", `${groupId}_${userId}`), { status: "rejected" });
  showToast("User rejected.", "info");
}
// =====================
// OUTCOME PANEL (INITIALIZATION & HANDLERS)
// =====================
function initializeOutcomePanel() {
  addDecision.addEventListener("click", () => {
    addDecisionModal.style.display = "flex";
    document.getElementById("newDecisionText").value = "";
    document.getElementById("newDecisionText").focus();
  });

  addAction.addEventListener("click", () => {
    addActionModal.style.display = "flex";
    document.getElementById("newActionText").value = "";
    document.getElementById("newActionOwner").value = "";
    document.getElementById("newActionDeadline").value = "";
    document.getElementById("newActionText").focus();
  });

  document.getElementById("cancelDecision").addEventListener("click", () => {
    addDecisionModal.style.display = "none";
  });

  document.getElementById("cancelAction").addEventListener("click", () => {
    addActionModal.style.display = "none";
  });

  outcomeSummary.addEventListener("input", async () => {
    if (AppState.conversation.current) {
      await updateDoc(doc(db, "groups", AppState.conversation.current.id), {
        "outcome.summary": outcomeSummary.value
      });
    }
  });

  // Wire modal buttons to Firestore
  document.getElementById("confirmDecision").onclick = async () => {
    const text = document.getElementById("newDecisionText").value.trim();
    if (text && AppState.conversation.current) {
      await updateOutcomeWithItem((outcome) => {
        outcome.decisions.push({ text, timestamp: new Date().toISOString() });
      });
      updateOutcomePanel();
      addDecisionModal.style.display = "none";
      document.getElementById("newDecisionText").value = "";
    }
  };

  document.getElementById("confirmAction").onclick = async () => {
    const text = document.getElementById("newActionText").value.trim();
    if (text && AppState.conversation.current) {
      await updateOutcomeWithItem((outcome) => {
        outcome.actions.push({
          text,
          owner: document.getElementById("newActionOwner").value.trim() || null,
          deadline: document.getElementById("newActionDeadline").value || null,
          completed: false
        });
      });
      updateOutcomePanel();
      addActionModal.style.display = "none";
      document.getElementById("newActionText").value = "";
    }
  };

  initializeOutcomeAccordions();
}

async function renderOutcomeItems(outcome, groupDocRef) {
  decisionsList.innerHTML = "";
  (outcome.decisions || []).forEach((decision, index) => {
    const div = document.createElement("div");
    div.className = "outcome-item";
    div.innerHTML = `
      <input type="checkbox" checked disabled />
      <span class="outcome-item-content">${escapeHtml(decision.text)}</span>
      <span class="outcome-item-remove" data-index="${index}">×</span>
    `;
    div.querySelector(".outcome-item-remove").addEventListener("click", async () => {
      outcome.decisions.splice(index, 1);
      await updateDoc(groupDocRef, { outcome });
      updateOutcomePanel();
    });
    decisionsList.appendChild(div);
  });

  actionsList.innerHTML = "";
  (outcome.actions || []).forEach((action, index) => {
    const div = document.createElement("div");
    div.className = "outcome-item";
    div.innerHTML = `
      <input type="checkbox" ${action.completed ? "checked" : ""} data-index="${index}" />
      <div style="flex: 1">
        <span class="outcome-item-content">${escapeHtml(action.text)}</span>
        <div class="outcome-item-meta">
          ${action.owner ? `<span>@${escapeHtml(action.owner)}</span>` : ""}
          ${action.deadline ? `<span>Due: ${action.deadline}</span>` : ""}
        </div>
      </div>
      <span class="outcome-item-remove" data-index="${index}">×</span>
    `;
    div.querySelector('input[type="checkbox"]').addEventListener("change", async (e) => {
      action.completed = e.target.checked;
      await updateDoc(groupDocRef, { outcome });
    });
    div.querySelector(".outcome-item-remove").addEventListener("click", async () => {
      outcome.actions.splice(index, 1);
      await updateDoc(groupDocRef, { outcome });
      updateOutcomePanel();
    });
    actionsList.appendChild(div);
  });
}

// Export/Save Handlers removed - persistent via sync

// =====================
// VIEW TOGGLE
// =====================
function initializeViewToggle() {
  viewBtns.forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  viewBtns.forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-view="${view}"]`)?.classList.add("active");

  if (view === "chats") {
    chatView.style.display = "flex";
    dashboardView.style.display = "none";
  } else {
    chatView.style.display = "none";
    dashboardView.style.display = "block";
    renderDashboard();
  }
}

async function renderDashboard() {
  const active = AppState.conversation.list.filter(c => c.status === "active");
  const closing = AppState.conversation.list.filter(c => c.status === "closing");
  const done = AppState.conversation.list.filter(c => c.status === "done");

  activeCount.textContent = active.length;
  closingCount.textContent = closing.length;
  completedCount.textContent = done.length;

  activeConversations.innerHTML = await renderConvCards(active);
  closingConversations.innerHTML = await renderConvCards(closing);
  completedOutcomes.innerHTML = await renderOutcomeCards(done);
}

async function renderConvCards(convs) {
  if (convs.length === 0) {
    return `
      <div class="empty-state-subtle">
        <p>No conversations matched.</p>
      </div>
    `;
  }

  // Card rendering is handled by the startSyncingConversations listener which calls renderDashboard
  // We just need to ensure the HTML strings are correct for the new model
  const htmls = await Promise.all(convs.map(async (conv, index) => {
    const intent = INTENTS[conv.intent];
    // Check membership
    const mid = `${conv.id}_${AppState.auth.user.uid}`;
    const mdoc = await getDoc(doc(db, "memberships", mid));
    const isMember = mdoc.exists() && mdoc.data().status === "accepted";

    return `
      <div class="conv-card" onclick="selectConversation('${conv.id}')" style="animation-delay: ${index * 50}ms">
        <div class="conv-card-header">
          <span class="conv-card-icon">${intent.icon}</span>
          <span class="conv-card-title">${escapeHtml(conv.name)}</span>
        </div>
        <div class="conv-card-body">${isMember ? intent.label : "Membership Pending / Required"}</div>
        <div class="conv-card-footer">
          <span>${formatDate(conv.createdAt?.toDate ? conv.createdAt.toDate() : new Date())}</span>
          <span class="conv-status ${conv.status}">${conv.status}</span>
        </div>
      </div>
    `;
  }));
  return htmls.join("");
}

async function renderOutcomeCards(convs) {
  if (convs.length === 0) {
    return `
      <div class="empty-state-subtle">
        <p>No outcomes recorded yet.</p>
      </div>
    `;
  }

  const htmls = await Promise.all(convs.map(async (conv, index) => {
    const intent = INTENTS[conv.intent];
    const outcome = conv.outcome || { decisions: [], actions: [] };
    const decisionCount = outcome.decisions?.length || 0;
    const actionCount = outcome.actions?.length || 0;

    return `
      <div class="conv-card outcome-card" onclick="selectConversation('${conv.id}')" style="animation-delay: ${index * 50}ms">
        <div class="conv-card-header">
          <span class="conv-card-icon">${intent.icon}</span>
          <span class="conv-card-title">${escapeHtml(conv.name)}</span>
        </div>
        <div class="conv-card-body">${decisionCount} decisions, ${actionCount} actions</div>
        <div class="conv-card-footer"><span>${formatDate(conv.createdAt?.toDate ? conv.createdAt.toDate() : new Date())}</span></div>
      </div>
    `;
  }));
  return htmls.join("");
}

// Make selectConversation global for onclick handlers
window.selectConversation = selectConversation;

// =====================
// AI HINTS
// =====================
function initializeAIHints() {
  aiHintDismiss.addEventListener("click", () => {
    aiHint.style.display = "none";
  });

  aiHintAction.addEventListener("click", async () => {
    const type = aiHintAction.dataset.type;
    const text = aiHintAction.dataset.text;

    if (type === "decision" && AppState.conversation.current) {
      await updateOutcomeWithItem((outcome) => {
        outcome.decisions.push({
          text,
          timestamp: new Date().toISOString()
        });
      });
      updateOutcomePanel();
      showToast("Decision added!", "success");
    } else if (type === "action" && AppState.conversation.current) {
      await updateOutcomeWithItem((outcome) => {
        outcome.actions.push({
          text,
          owner: null,
          deadline: null,
          completed: false
        });
      });
      updateOutcomePanel();
      showToast("Action added!", "success");
    }

    aiHint.style.display = "none";
  });
}

function detectAIPatterns(message) {
  for (const pattern of AI_PATTERNS.decision) {
    if (pattern.test(message)) {
      showAIHint("decision", message, "Possible decision detected");
      return;
    }
  }

  for (const pattern of AI_PATTERNS.action) {
    if (pattern.test(message)) {
      showAIHint("action", message, "Possible action item detected");
      return;
    }
  }
}

function showAIHint(type, text, label) {
  aiHintText.textContent = label;
  aiHintAction.textContent = type === "decision" ? "Add to Decisions" : "Add to Actions";
  aiHintAction.dataset.type = type;
  aiHintAction.dataset.text = text;
  aiHint.style.display = "flex";

  setTimeout(() => {
    aiHint.style.display = "none";
  }, 10000);
}

// =====================
// UTILITIES
// =====================
async function updateOutcomeWithItem(updateFn) {
  if (!AppState.conversation.current) return null;
  const groupRef = doc(db, "groups", AppState.conversation.current.id);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) return null;
  const outcome = groupSnap.data().outcome || { summary: "", decisions: [], actions: [] };
  updateFn(outcome);
  await updateDoc(groupRef, { outcome });
  return groupRef;
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

function formatDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });
}

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = "info") {
  const colors = {
    error: "#FF3B30",
    success: "#34C759",
    info: "#0A84FF"
  };

  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// =====================
// UX & NAVIGATION
// =====================
function initializeMobileNavigation() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebarClose = document.getElementById('sidebarClose');
  const sidebar = document.querySelector('.sidebar');

  if (menuToggle && sidebar) {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }

    const toggle = (force) => {
      const isVisible = typeof force === 'boolean' ? force : !sidebar.classList.contains('visible');
      sidebar.classList.toggle('visible', isVisible);
      overlay.classList.toggle('visible', isVisible);
      document.body.style.overflow = isVisible ? 'hidden' : '';
    };

    menuToggle.addEventListener('click', () => toggle(true));
    if (sidebarClose) {
      sidebarClose.addEventListener('click', () => toggle(false));
    }
    overlay.addEventListener('click', () => toggle(false));

    // Handle Outcome Panel Toggle
    const toggleOutcomeBtn = document.getElementById('toggleOutcomePanel');
    const outcomePanel = document.getElementById('outcomePanel');
    const closeOutcomePanel = document.getElementById('closeOutcomePanel');

    const toggleOutcome = (force) => {
      const isOpen = typeof force === 'boolean' ? force : !outcomePanel.classList.contains('collapsed');
      outcomePanel.classList.toggle('collapsed', !isOpen);
      if (isOpen && window.innerWidth <= 1023) {
        // On mobile/tablet, show overlay if outcome is visible
        overlay.classList.add('visible');
      } else if (!isOpen && window.innerWidth <= 1023) {
        // If sidebar is also not visible, hide overlay
        if (!sidebar.classList.contains('visible')) {
          overlay.classList.remove('visible');
        }
      }
    };

    if (toggleOutcomeBtn && outcomePanel) {
      // Use addEventListener to avoid overwriting other potential listeners
      toggleOutcomeBtn.onclick = null; // Clear any previously set onclick
      toggleOutcomeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleOutcome();
      });
    }
    if (closeOutcomePanel) {
      closeOutcomePanel.onclick = null; // Clear
      closeOutcomePanel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleOutcome(false);
      });
    }

    // Close on navigation
    const originalSelectConversation = window.selectConversation;
    window.selectConversation = function (id) {
      if (typeof originalSelectConversation === 'function') {
        originalSelectConversation(id);
      }
      // On mobile views, close all panels when switching conversations
      if (window.innerWidth <= 1023) {
        toggle(false);
        toggleOutcome(false);
      }
    };

    // Window Resize Handler
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 1023) {
          // Reset mobile states when returning to desktop
          sidebar.classList.remove('visible');
          overlay.classList.remove('visible');
          document.body.style.overflow = '';
        }

        // Smart-collapse outcome panel on medium screens if not explicitly toggled
        if (window.innerWidth <= 1023) {
          outcomePanel.classList.add('collapsed');
        } else if (window.innerWidth < 1366) {
          outcomePanel.classList.add('collapsed');
        } else if (window.innerWidth >= 1366) {
          outcomePanel.classList.remove('collapsed');
        }
      }, 250);
    });

    // Initial check for laptop screens
    if (window.innerWidth < 1366) {
      outcomePanel?.classList.add('collapsed');
    }
  }
}

function initializeOutcomeAccordions() {
  const sections = document.querySelectorAll('.outcome-section');
  sections.forEach(section => {
    const label = section.querySelector('.outcome-label');
    if (label) {
      label.style.cursor = 'pointer';
      label.title = 'Toggle Section';
      label.addEventListener('click', () => {
        section.classList.toggle('collapsed');
      });
    }
  });
}
