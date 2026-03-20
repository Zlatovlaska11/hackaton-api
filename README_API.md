# API Documentation & Setup

This document provides instructions on how to set up the environment and interact with the API.

## 1. Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

## 2. Local Setup

### Step 1: Start the Database

Run the following command to start the PostgreSQL container in the background:

```bash
docker-compose up -d
```

### Step 2: Initialize the Database

This will create the tables and seed the initial users (`john` and `maria`):

```bash
npx prisma migrate dev
```

### Step 3: Start the Application

```bash
npm run start:dev
```

The API will be available at `http://localhost:3001`.

---

## 3. API Usage (Examples)

### Authentication

#### A. Register

Create a new user and receive a JWT access token.
`petType` must be one of `city`, `water`, or `tree`.

**Request:**

```bash
curl -X POST http://localhost:3001/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"newuser","password":"mypassword","petType":"city","petName":"Rex"}'
```

**Success Response (201 Created):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### B. Login

Exchange your credentials for a JWT access token.

**Request:**

```bash
curl -X POST http://localhost:3001/auth/login \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "username=john&password=changeme"
```

**Success Response (201 Created):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### C. Get Profile (Protected Route)

Access your user profile using the JWT token obtained from login.

**Request:**
_(Replace `<YOUR_TOKEN>` with the actual token)_

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/auth/profile
```

**Success Response (200 OK):**

```json
{
  "userId": 1,
  "username": "john",
  "petType": null,
  "petName": null
}
```

#### D. Get My Profile (Protected Route)

Returns the authenticated user's full profile from the database.

**Request:**
_(Replace `<YOUR_TOKEN>` with the actual token)_

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/auth/me
```

**Success Response (200 OK):**

```json
{
  "userId": 1,
  "username": "john",
  "petType": null,
  "petName": null
}
```

**Unauthorized Response (401 Unauthorized):**
If the token is missing or invalid:

```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

---

### Users (Protected Routes)

All user discovery endpoints require `Authorization: Bearer <YOUR_TOKEN>`.

#### A. List Users For Chat

Returns chat-ready users with only `userId` and `username`. The authenticated user is excluded.

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     "http://localhost:3001/users?search=ma&limit=20"
```

**Success Response (200 OK):**

```json
[
  {
    "userId": 2,
    "username": "maria"
  }
]
```

#### B. Get One User

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/users/2
```

**Success Response (200 OK):**

```json
{
  "userId": 2,
  "username": "maria",
  "petType": null,
  "petName": null
}
```

#### C. List My Friends

Returns accepted friends for the authenticated user.

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/users/friends
```

**Success Response (200 OK):**

```json
[
  {
    "userId": 2,
    "username": "maria",
    "friendsSince": "2026-03-20T19:45:00.000Z"
  }
]
```

#### D. List Friend Requests

Returns pending incoming and outgoing friend requests for the authenticated user.

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/users/friends/requests
```

**Success Response (200 OK):**

```json
{
  "incoming": [
    {
      "id": 4,
      "createdAt": "2026-03-20T19:40:00.000Z",
      "user": {
        "userId": 2,
        "username": "maria"
      }
    }
  ],
  "outgoing": []
}
```

#### E. Send A Friend Request

**Request:**

```bash
curl -X POST http://localhost:3001/users/friends/requests \
     -H "Authorization: Bearer <YOUR_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"receiverId":2}'
```

**Success Response (201 Created):**

```json
{
  "id": 4,
  "requesterId": 1,
  "receiverId": 2,
  "status": "PENDING",
  "createdAt": "2026-03-20T19:40:00.000Z",
  "acceptedAt": null,
  "requester": {
    "userId": 1,
    "username": "john"
  },
  "receiver": {
    "userId": 2,
    "username": "maria"
  }
}
```

#### F. Accept A Friend Request

**Request:**

```bash
curl -X POST http://localhost:3001/users/friends/requests/4/accept \
     -H "Authorization: Bearer <YOUR_TOKEN>"
```

**Success Response (201 Created):**

```json
{
  "id": 4,
  "requesterId": 1,
  "receiverId": 2,
  "status": "ACCEPTED",
  "createdAt": "2026-03-20T19:40:00.000Z",
  "acceptedAt": "2026-03-20T19:45:00.000Z",
  "requester": {
    "userId": 1,
    "username": "john"
  },
  "receiver": {
    "userId": 2,
    "username": "maria"
  }
}
```

---

## 4. WebSocket Chat

The API provides a real-time chat over WebSockets using Socket.io, backed by PostgreSQL.

- **URL:** `ws://localhost:3001`
- **Events Protocol:**
  1. Emit **`auth`**: Pass payload `{"token": "YOUR_JWT_HERE"}` as the very first message. The server will authenticate you and emit `auth_result` with success status. You must authenticate before sending messages.
  2. Emit **`send_message`**: Pass payload `{"receiverId": 2, "text": "Hello!"}` to send a message. The server identifies your user as the sender, validates the receiver, saves the message to the database, and emits it only to the sender and receiver.
  3. Listen for **`receive_message`**: To receive incoming messages for authenticated conversations.

## 5. Chat REST Endpoints

These endpoints are useful for inbox views, chat sidebars, and loading conversation history before the socket connects.

#### A. List Recent Conversations

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     "http://localhost:3001/chat/conversations?limit=20"
```

**Success Response (200 OK):**

```json
[
  {
    "user": {
      "userId": 2,
      "username": "maria"
    },
    "lastMessage": {
      "id": 14,
      "text": "See you at 6",
      "senderId": 2,
      "receiverId": 1,
      "createdAt": "2026-03-20T18:15:00.000Z"
    }
  }
]
```

#### B. Get Conversation History

**Request:**

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     "http://localhost:3001/chat/messages/2?limit=50"
```

**Success Response (200 OK):**

```json
{
  "user": {
    "userId": 2,
    "username": "maria"
  },
  "messages": [
    {
      "id": 11,
      "text": "Hello!",
      "senderId": 1,
      "receiverId": 2,
      "createdAt": "2026-03-20T18:10:00.000Z"
    }
  ]
}
```

#### C. Send A Message Over HTTP

**Request:**

```bash
curl -X POST http://localhost:3001/chat/messages \
     -H "Authorization: Bearer <YOUR_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"receiverId":2,"text":"Hello from HTTP"}'
```

**Success Response (201 Created):**

```json
{
  "id": 15,
  "text": "Hello from HTTP",
  "senderId": 1,
  "receiverId": 2,
  "createdAt": "2026-03-20T18:20:00.000Z"
}
```

## 6. Troubleshooting

- **Check Container Status:** `docker ps`
- **View App Logs:** `npm run start:dev` (check the console output)
- **Database GUI:** You can use Prisma Studio to view your data in the browser:
  ```bash
  npx prisma studio
  ```
