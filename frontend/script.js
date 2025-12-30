// DOM Elements
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const typingIndicator = document.getElementById("typingIndicator");
const typingText = document.getElementById("typingText");
const onlineCount = document.getElementById("onlineCount");
const authModal = document.getElementById("authModal");
const appContainer = document.getElementById("appContainer");
const groupsList = document.getElementById("groupsList");
const currentGroupTitle = document.getElementById("currentGroupTitle");
const createGroupBtn = document.getElementById("createGroupBtn");
const createGroupModal = document.getElementById("createGroupModal");
const createGroupForm = document.getElementById("createGroupForm");
const newGroupNameInput = document.getElementById("newGroupName");
const cancelCreateGroupBtn = document.getElementById("cancelCreateGroup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authTabs = document.querySelectorAll(".auth-tab");
const authError = document.getElementById("authError");
const userInfo = document.getElementById("userInfo");
const userName = document.getElementById("userName");
const logoutBtn = document.getElementById("logoutBtn");
const guestBanner = document.getElementById("guestBanner");

// Socket.io connection (will be initialized after auth)
let socket = null;

// Current user's info
let currentUser = { username: null, email: null, isAuthenticated: false, token: null };

// Current active group
let currentGroup = "General";

// All groups and user's groups
let allGroups = ["General"];
let userGroups = ["General"];

// Typing timeout
let typingTimeout = null;
const TYPING_TIMEOUT = 3000; // 3 seconds

// Initialize Authentication
initializeAuth();

// Authentication Functions
function initializeAuth() {
  // Check if user has valid token
  const token = localStorage.getItem("talkio_token");
  if (token) {
    // Verify token with server
    verifyToken(token);
  } else {
    // Show auth modal
    showAuthModal();
  }
  
  // Auth tab switching
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

  // Helper function to get active tab
  function getActiveTab() {
    const activeTab = document.querySelector(".auth-tab.active");
    return activeTab ? activeTab.dataset.tab : "login";
  }

  // Login form
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    // Only process if Login tab is active
    if (getActiveTab() !== "login") {
      return;
    }
    
    const emailOrUsername = document.getElementById("loginEmailOrUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    
    if (emailOrUsername && password) {
      await handleLogin(emailOrUsername, password);
    }
  });

  // Signup form
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    // Only process if Sign Up tab is active
    if (getActiveTab() !== "signup") {
      return;
    }
    
    const username = document.getElementById("signupUsername").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    
    if (username && email && password) {
      await handleSignup(username, email, password);
    }
  });
  
  // Logout button
  logoutBtn.addEventListener("click", handleLogout);
}

async function verifyToken(token) {
  try {
    const response = await fetch("/auth/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      currentUser = {
        username: data.username,
        email: data.email,
        isAuthenticated: true,
        token: token
      };
      showApp();
      initializeSocket();
    } else {
      // Invalid token, clear it
      localStorage.removeItem("talkio_token");
      showAuthModal();
    }
  } catch (error) {
    console.error("Token verification error:", error);
    localStorage.removeItem("talkio_token");
    showAuthModal();
  }
}

async function handleLogin(emailOrUsername, password) {
  clearAuthError();
  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ emailOrUsername, password })
    });
    
    // Defensive JSON parsing - only parse if response is ok
    if (response.ok) {
      const data = await response.json();
      currentUser = {
        username: data.username,
        email: data.email,
        isAuthenticated: true,
        token: data.token
      };
      localStorage.setItem("talkio_token", data.token);
      showApp();
      initializeSocket();
    } else {
      // Try to parse error response, but handle gracefully if it fails
      let errorMessage = "Login failed";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // If JSON parsing fails, use status text or default message
        errorMessage = response.statusText || errorMessage;
      }
      showAuthError(errorMessage);
    }
  } catch (error) {
    console.error("Login error:", error);
    showAuthError("Network error. Please try again.");
  }
}

async function handleSignup(username, email, password) {
  clearAuthError();
  try {
    const response = await fetch("/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, email, password })
    });
    
    // Defensive JSON parsing - only parse if response is ok
    if (response.ok) {
      const data = await response.json();
      currentUser = {
        username: data.username,
        email: data.email,
        isAuthenticated: true,
        token: data.token
      };
      localStorage.setItem("talkio_token", data.token);
      showApp();
      initializeSocket();
    } else {
      // Try to parse error response, but handle gracefully if it fails
      let errorMessage = "Signup failed";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // If JSON parsing fails, use status text or default message
        if (response.status === 404) {
          errorMessage = "Server route not found. Please ensure the server is running and restart it if needed.";
        } else {
          errorMessage = response.statusText || errorMessage;
        }
      }
      showAuthError(errorMessage);
    }
  } catch (error) {
    console.error("Signup error:", error);
    if (error.message && error.message.includes("Failed to fetch")) {
      showAuthError("Cannot connect to server. Please ensure the server is running on localhost:3000");
    } else {
      showAuthError("Network error. Please try again.");
    }
  }
}

function handleLogout() {
  // Clear token and user data
  localStorage.removeItem("talkio_token");
  currentUser = { username: null, email: null, isAuthenticated: false, token: null };
  
  // Disconnect socket
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  // Show auth modal
  showAuthModal();
}

function showAuthError(message) {
  authError.textContent = message;
  authError.style.display = "block";
}

function clearAuthError() {
  authError.textContent = "";
  authError.style.display = "none";
}

function showAuthModal() {
  authModal.style.display = "flex";
  appContainer.style.display = "none";
}

function showApp() {
  authModal.style.display = "none";
  appContainer.style.display = "flex";
}

// Socket Initialization
function initializeSocket() {
  socket = io();

  // EXISTING Socket Events (preserved for backward compatibility)
  socket.on("receive-messages", (data) => {
    const { chatHistory, username } = data || {};
    
    // Update username if provided (first connection)
    if (username) {
      // If we don't have a saved username, use the generated one
      if (!currentUsername || !localStorage.getItem("talkio_username")) {
        currentUsername = username;
        localStorage.setItem("talkio_username", username);
      }
    }
    
    // Only render if we're in General group (legacy support)
    if (currentGroup === "General" && chatHistory) {
      renderMessages(chatHistory);
    }
  });

  // EXTENSION: Handle username confirmation from server
  socket.on("username-set", (data) => {
    const { username } = data || {};
    if (username) {
      currentUsername = username;
      localStorage.setItem("talkio_username", username);
    }
  });

  socket.on("user-count", (count) => {
    updateOnlineCount(count);
  });

  socket.on("user-typing", (data) => {
    const { username, isTyping, group } = data || {};
    // Only show typing indicator for current group
    if (!group || group === currentGroup) {
      showTypingIndicator(username, isTyping);
    }
  });

  // EXTENSION: New socket events for groups
  socket.on("group-messages", (data) => {
    const { group, chatHistory } = data || {};
    if (group === currentGroup && chatHistory) {
      renderMessages(chatHistory);
    }
  });

  socket.on("all-groups", (groups) => {
    allGroups = groups || ["General"];
    renderGroupsList();
  });

  socket.on("user-groups", (groups) => {
    userGroups = groups || ["General"];
    renderGroupsList();
  });

  socket.on("error", (data) => {
    const { message } = data || {};
    if (message) {
      alert(message); // Simple error display - can be enhanced
    }
  });

  // Initialize event listeners
  initializeEventListeners();
}

// Event Listeners
function initializeEventListeners() {
  // Form submission
  chatForm.addEventListener("submit", handleSubmit);
  
  // Input change - enable/disable send button
  messageInput.addEventListener("input", handleInputChange);
  
  // Enter key support
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendButton.disabled) {
        handleSubmit(e);
      }
    }
  });
  
  // Typing indicators
  messageInput.addEventListener("input", handleTyping);
  
  // Stop typing when input loses focus
  messageInput.addEventListener("blur", () => {
    if (socket) {
      socket.emit("typing-stop", { group: currentGroup });
    }
    clearTypingTimeout();
  });

  // Group management
  createGroupBtn.addEventListener("click", () => {
    createGroupModal.style.display = "flex";
    newGroupNameInput.focus();
  });

  cancelCreateGroupBtn.addEventListener("click", () => {
    createGroupModal.style.display = "none";
    newGroupNameInput.value = "";
  });

  createGroupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const groupName = newGroupNameInput.value.trim();
    if (groupName && socket) {
      socket.emit("create-group", { groupName });
      createGroupModal.style.display = "none";
      newGroupNameInput.value = "";
    }
  });

  // Close modal on overlay click
  createGroupModal.addEventListener("click", (e) => {
    if (e.target === createGroupModal) {
      createGroupModal.style.display = "none";
      newGroupNameInput.value = "";
    }
  });
}

function handleSubmit(e) {
  e.preventDefault();
  
  // Check authentication
  if (!currentUser.isAuthenticated) {
    showAuthError("Please log in to send messages");
    return;
  }
  
  const message = messageInput.value.trim();
  
  if (message && socket) {
    sendMessage(message);
    messageInput.value = "";
    sendButton.disabled = true;
    
    // Stop typing indicator
    socket.emit("typing-stop", { group: currentGroup });
    clearTypingTimeout();
  }
}

function handleInputChange() {
  if (!currentUser.isAuthenticated) {
    sendButton.disabled = true;
    return;
  }
  const hasText = messageInput.value.trim().length > 0;
  sendButton.disabled = !hasText;
}

function handleTyping() {
  const message = messageInput.value.trim();
  
  if (message && socket) {
    socket.emit("typing-start", { group: currentGroup });
    clearTypingTimeout();
    
    // Stop typing indicator after timeout
    typingTimeout = setTimeout(() => {
      if (socket) {
        socket.emit("typing-stop", { group: currentGroup });
      }
    }, TYPING_TIMEOUT);
  } else {
    if (socket) {
      socket.emit("typing-stop", { group: currentGroup });
    }
    clearTypingTimeout();
  }
}

function clearTypingTimeout() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}

// Socket Functions
function sendMessage(message) {
  if (socket) {
    socket.emit("post-message", {
      message,
      group: currentGroup,
    });
  }
}

// Group Management Functions
function switchGroup(groupName) {
  if (groupName === currentGroup) return;
  
  currentGroup = groupName;
  currentGroupTitle.textContent = groupName;
  
  // Clear current messages
  chatMessages.innerHTML = "";
  
  // Request group messages
  if (socket) {
    socket.emit("join-group", { groupName });
  }
  
  // Update active group in sidebar
  renderGroupsList();
}

function joinGroup(groupName) {
  if (socket && !userGroups.includes(groupName)) {
    socket.emit("join-group", { groupName });
  }
}

function leaveGroup(groupName) {
  if (socket && groupName !== "General") {
    socket.emit("leave-group", { groupName });
    
    // If leaving current group, switch to General
    if (currentGroup === groupName) {
      switchGroup("General");
    }
  }
}

function renderGroupsList() {
  groupsList.innerHTML = "";
  
  allGroups.forEach(groupName => {
    const groupItem = document.createElement("div");
    groupItem.className = `group-item ${groupName === currentGroup ? "active" : ""}`;
    
    const isInGroup = userGroups.includes(groupName);
    const canLeave = groupName !== "General";
    const isAuthenticated = currentUser.isAuthenticated;
    
    groupItem.innerHTML = `
      <span class="group-item-name">${escapeHtml(groupName)}</span>
      ${isInGroup && canLeave && isAuthenticated ? `
        <div class="group-item-actions">
          <button class="group-item-btn" onclick="leaveGroup('${escapeHtml(groupName)}')" title="Leave group">×</button>
        </div>
      ` : ""}
      ${!isInGroup && !isAuthenticated ? `
        <span class="group-item-lock">🔒</span>
      ` : ""}
    `;
    
    if (isInGroup && isAuthenticated) {
      groupItem.addEventListener("click", (e) => {
        if (!e.target.classList.contains("group-item-btn")) {
          switchGroup(groupName);
        }
      });
    } else if (!isInGroup && isAuthenticated) {
      groupItem.style.opacity = "0.8";
      groupItem.style.cursor = "pointer";
      groupItem.addEventListener("click", () => {
        joinGroup(groupName);
      });
    } else {
      groupItem.style.opacity = "0.6";
      groupItem.style.cursor = "not-allowed";
    }
    
    groupsList.appendChild(groupItem);
  });
}

// Rendering Functions
function renderMessages(chatHistory) {
  chatMessages.innerHTML = "";
  
  if (!chatHistory || chatHistory.length === 0) {
    return;
  }
  
  // FIXED: Messages are already in chronological order (older at top, newer at bottom)
  // Group consecutive messages by same user
  const groupedMessages = [];
  let currentGroup = null;
  
  chatHistory.forEach((item, index) => {
    if (item.type === "system") {
      // System messages break grouping
      if (currentGroup) {
        groupedMessages.push(currentGroup);
        currentGroup = null;
      }
      groupedMessages.push({ type: "system", item });
    } else {
      // User message
      const isSelf = item.username === currentUser.username;
      const isSameUser = currentGroup && 
                        currentGroup.type === "user" && 
                        currentGroup.username === item.username &&
                        currentGroup.isSelf === isSelf;
      
      if (isSameUser) {
        // Add to current group
        currentGroup.messages.push(item);
      } else {
        // Start new group
        if (currentGroup) {
          groupedMessages.push(currentGroup);
        }
        currentGroup = {
          type: "user",
          username: item.username,
          isSelf: isSelf,
          messages: [item]
        };
      }
    }
  });
  
  // Add last group
  if (currentGroup) {
    groupedMessages.push(currentGroup);
  }
  
  // Render grouped messages (in chronological order - append to DOM)
  groupedMessages.forEach(group => {
    if (group.type === "system") {
      renderSystemMessage(group.item);
    } else {
      renderUserMessageGroup(group);
    }
  });
  
  // Auto-scroll to bottom (newest messages)
  scrollToBottom();
}

function renderUserMessageGroup(group) {
  const { username, isSelf, messages } = group;
  
  const groupDiv = document.createElement("div");
  groupDiv.className = "message-group";
  
  messages.forEach((item, index) => {
    const isFirst = index === 0;
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isSelf ? "self" : "other"}`;
    
    const formattedTime = formatTimestamp(item.timestamp);
    
    messageDiv.innerHTML = `
      ${isFirst ? `
        <div class="message-header">
          <span class="message-username">${escapeHtml(username)}</span>
          <span class="message-timestamp">${formattedTime}</span>
        </div>
      ` : ""}
      <div class="message-bubble">
        <div class="message-content">${escapeHtml(item.message)}</div>
      </div>
    `;
    
    groupDiv.appendChild(messageDiv);
  });
  
  chatMessages.appendChild(groupDiv);
  // Auto-scroll after appending (chronological order - newest at bottom)
  scrollToBottom();
}

function renderSystemMessage(item) {
  const { event, username, group } = item;
  
  const systemDiv = document.createElement("div");
  systemDiv.className = "system-message";
  
  let eventText = "";
  if (event === "user-joined") {
    eventText = `<span class="system-username">${escapeHtml(username)}</span> joined the chat`;
  } else if (event === "user-left") {
    eventText = `<span class="system-username">${escapeHtml(username)}</span> left the chat`;
  } else if (event === "user-joined-group") {
    eventText = `<span class="system-username">${escapeHtml(username)}</span> joined ${escapeHtml(group || "")}`;
  } else if (event === "user-left-group") {
    eventText = `<span class="system-username">${escapeHtml(username)}</span> left ${escapeHtml(group || "")}`;
  }
  
  systemDiv.innerHTML = eventText;
  chatMessages.appendChild(systemDiv);
}

function showTypingIndicator(username, isTyping) {
  if (isTyping) {
    typingText.textContent = `${username} is typing...`;
    typingIndicator.classList.add("active");
  } else {
    typingIndicator.classList.remove("active");
    typingText.textContent = "";
  }
}

function updateOnlineCount(count) {
  onlineCount.textContent = count || 0;
}

// Utility Functions
function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  // Show relative time for recent messages
  if (diffMins < 1) {
    return "just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else {
    // Show time for older messages
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, "0");
    return `${displayHours}:${displayMinutes} ${ampm}`;
  }
}

function scrollToBottom() {
  // Use requestAnimationFrame for smooth scrolling
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.switchGroup = switchGroup;
window.joinGroup = joinGroup;
window.leaveGroup = leaveGroup;
