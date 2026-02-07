// Firebase Admin SDK Configuration for Talkio
import admin from "firebase-admin";

// Initialize Firebase Admin with application default credentials
// For production, use a service account key file
const firebaseConfig = {
    projectId: "talkio-f7365",
    databaseURL: "https://talkio-f7365-default-rtdb.firebaseio.com"
};

// Initialize Firebase Admin (without service account for development)
// Note: For production, download service account key from Firebase Console
if (!admin.apps.length) {
    admin.initializeApp(firebaseConfig);
}

// Get Realtime Database reference
const db = admin.database();

// Database helper functions
export const firebaseDb = {
    // Users
    async createUser(email, userData) {
        const emailKey = email.replace(/\./g, ","); // Firebase doesn't allow . in keys
        await db.ref(`users/${emailKey}`).set({
            ...userData,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        });
        return userData;
    },

    async getUser(email) {
        const emailKey = email.replace(/\./g, ",");
        const snapshot = await db.ref(`users/${emailKey}`).once("value");
        return snapshot.val();
    },

    async getUserByUsername(username) {
        const snapshot = await db.ref("users").once("value");
        const users = snapshot.val() || {};
        for (const [key, userData] of Object.entries(users)) {
            if (userData.username && userData.username.toLowerCase() === username.toLowerCase()) {
                return userData;
            }
        }
        return null;
    },

    async getAllUsers() {
        const snapshot = await db.ref("users").once("value");
        return snapshot.val() || {};
    },

    async updateUserLastSeen(email) {
        const emailKey = email.replace(/\./g, ",");
        await db.ref(`users/${emailKey}/lastSeen`).set(new Date().toISOString());
    },

    // Messages
    async addMessage(groupName, messageData) {
        const ref = db.ref(`messages/${groupName}`).push();
        await ref.set({
            ...messageData,
            id: ref.key
        });
        return ref.key;
    },

    async getGroupMessages(groupName, limit = 100) {
        const snapshot = await db.ref(`messages/${groupName}`)
            .orderByChild("timestamp")
            .limitToLast(limit)
            .once("value");

        const messages = [];
        snapshot.forEach((child) => {
            messages.push(child.val());
        });
        return messages;
    },

    // Groups
    async createGroup(groupName, createdBy) {
        await db.ref(`groups/${groupName}`).set({
            name: groupName,
            createdAt: new Date().toISOString(),
            createdBy: createdBy
        });
    },

    async getGroup(groupName) {
        const snapshot = await db.ref(`groups/${groupName}`).once("value");
        return snapshot.val();
    },

    async getAllGroups() {
        const snapshot = await db.ref("groups").once("value");
        const groups = snapshot.val() || {};
        return Object.keys(groups);
    },

    async groupExists(groupName) {
        const snapshot = await db.ref(`groups/${groupName}`).once("value");
        return snapshot.exists();
    },

    // Initialize default General group
    async initializeDefaultGroup() {
        const exists = await this.groupExists("General");
        if (!exists) {
            await this.createGroup("General", "system");
        }
    }
};

// Export admin for direct access if needed
export { admin, db };
