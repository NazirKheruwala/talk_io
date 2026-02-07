# Talk_io - Real-time Chat Application

A modern chat application with Firebase backend, built for outcome-driven conversations with decision tracking and action items.

## 🚀 Features

- Real-time messaging with Firebase Realtime Database & Firestore
- User authentication with Firebase Auth  
- Conversation intents (Decision, Brainstorm, Support, Learning, Planning)
- Outcome tracking with decisions and action items
- Mobile-responsive design
- Admin approval system for group joins
- Time-limited conversations (optional)

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Firebase project with:
  - Authentication enabled
  - Firestore database
  - Realtime Database
  - Service Account key (for backend)

## 🛠️ Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Talk_io
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Firebase Configuration

#### Frontend Configuration

1. Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication (Email/Password)
3. Create Firestore and Realtime Database
4. Copy your Firebase config from Project Settings
5. Update `frontend/firebase-client-config.js` with your configuration

#### Backend Configuration

1. Download your Firebase Admin SDK service account key:
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save as `serviceAccountKey.json` in the project root
   
2. Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

3. Update `.env` with your configuration:

```env
JWT_SECRET=your_secure_random_string_minimum_32_characters
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
PORT=3000
```

### 4. Deploy Firebase Security Rules

Deploy the security rules to your Firebase project:

```bash
# Install Firebase CLI if you haven't
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (select Firestore and Realtime Database)
firebase init

# Deploy security rules
firebase deploy --only firestore:rules,database
```

## 🏃‍♂️ Running the Application

### Development Mode

```bash
# Start the backend server with auto-reload
npm run serve
```

The backend will start on `http://localhost:3000`

### Frontend

Open `frontend/index.html` in a modern web browser, or use a local server:

```bash
# Using Python 3
cd frontend
python -m http.server 8000

# Or using Node.js http-server
npx http-server frontend -p 8000
```

Then visit `http://localhost:8000`

### Production Mode

```bash
npm run completed
```

## 📁 Project Structure

```
Talk_io/
├── frontend/
│   ├── index.html              # Main HTML file
│   ├── script.js               # Frontend JavaScript (Firebase client)
│   ├── styles.css              # Application styles
│   └── firebase-client-config.js # Firebase client configuration
├── backend/
│   ├── server-completed.js     # Express server with Socket.io
│   ├── firebase-config.js      # Firebase Admin SDK configuration
│   ├── firestore.rules         # Firestore security rules
│   └── database.rules.json     # Realtime Database security rules
├── .env                        # Environment variables (create from .env.example)
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore file
├── package.json                # Dependencies and scripts
└── README.md                   # This file
```

## 🔒 Security Notes

- **Never commit** `.env` or `serviceAccountKey.json` to version control
- Firebase client API keys are safe to expose in frontend code
- Security is enforced through Firebase Security Rules
- JWT secret should be a long, random string
- Always use HTTPS in production

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret key for JWT token generation | Yes |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service account key | Yes |
| `PORT` | Backend server port | No (default: 3000) |
| `NODE_ENV` | Environment (development/production) | No |

## 🐛 Common Issues

### "Authentication failed" error
- Verify your Firebase service account key is correctly configured
- Ensure `GOOGLE_APPLICATION_CREDENTIALS` path is correct
- Check that Authentication is enabled in Firebase Console

### "Permission denied" errors
- Deploy Firebase security rules: `firebase deploy --only firestore:rules,database`
- Verify user is authenticated before accessing protected data

### Messages not appearing
- Check browser console for errors
- Verify Firestore and Realtime Database are properly initialized
- Ensure user has "accepted" membership status for the group

## 📝 Scripts

- `npm run serve` - Start development server with nodemon
- `npm run completed` - Start production server

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

ISC

## 🙋‍♂️ Support

For issues and questions, please open an issue on GitHub.