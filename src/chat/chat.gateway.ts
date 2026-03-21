import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { HttpException } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private chatService: ChatService,
    private usersService: UsersService,
  ) {}

  @SubscribeMessage('auth')
  async handleAuth(
    @MessageBody() data: { token: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const payload = this.jwtService.verify(data.token);
      await this.usersService.markUserActive(payload.sub);
      client.data.user = payload;
      client.join(this.getUserRoom(payload.sub));
      client.emit('auth_result', { success: true });
    } catch {
      client.emit('auth_result', { success: false, message: 'Invalid token' });
    }
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: { receiverId: number; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.data.user) {
      client.emit('error', {
        message: 'Unauthorized, please authenticate first',
      });
      return;
    }

    const senderId = client.data.user.sub;

    try {
      await this.usersService.markUserActive(senderId);
      const message = await this.chatService.createMessage(
        senderId,
        data.receiverId,
        data.text,
      );
      const receiverRoom = this.getUserRoom(message.receiverId);
      const senderRoom = this.getUserRoom(message.senderId);

      this.server
        .to(receiverRoom)
        .to(senderRoom)
        .emit('receive_message', message);
    } catch (error) {
      const message =
        error instanceof HttpException
          ? error.message
          : 'Unable to send message';
      client.emit('error', { message });
    }
  }

  private getUserRoom(userId: number) {
    return `user:${userId}`;
  }
}
