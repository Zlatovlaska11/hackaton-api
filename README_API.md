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

**Request:**
```bash
curl -X POST http://localhost:3001/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"newuser","password":"mypassword"}'
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
*(Replace `<YOUR_TOKEN>` with the actual token)*
```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
     http://localhost:3001/auth/profile
```

**Success Response (200 OK):**
```json
{
  "userId": 1,
  "username": "john"
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

---

## 4. WebSocket Chat

The API provides a real-time chat over WebSockets using Socket.io, backed by PostgreSQL.

- **URL:** `ws://localhost:3001`
- **Events Protocol:**
  1. Emit **`auth`**: Pass payload `{"token": "YOUR_JWT_HERE"}` as the very first message. The server will authenticate you and emit `auth_result` with success status. You must authenticate before sending messages.
  2. Emit **`send_message`**: Pass payload `{"receiverId": 2, "text": "Hello!"}` to send a message. The server identifies your user as the sender, saves the message to the database, and then broadcasts it.
  3. Listen for **`receive_message`**: To receive incoming broadcast messages from the server.

---

## 5. Troubleshooting

- **Check Container Status:** `docker ps`
- **View App Logs:** `npm run start:dev` (check the console output)
- **Database GUI:** You can use Prisma Studio to view your data in the browser:
  ```bash
  npx prisma studio
  ```
