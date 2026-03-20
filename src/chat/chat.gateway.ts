import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    WebSocketServer,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

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
        private prisma: PrismaService,
    ) { }

    @SubscribeMessage('auth')
    async handleAuth(@MessageBody() data: { token: string }, @ConnectedSocket() client: Socket) {
        try {
            const payload = this.jwtService.verify(data.token);
            client.data.user = payload; // Store user context on socket
            client.emit('auth_result', { success: true });
        } catch (e) {
            client.emit('auth_result', { success: false, message: 'Invalid token' });
        }
    }

    @SubscribeMessage('send_message')
    async handleMessage(@MessageBody() data: { receiverId: number, text: string }, @ConnectedSocket() client: Socket) {
        if (!client.data.user) {
            client.emit('error', { message: 'Unauthorized, please authenticate first' });
            return;
        }

        const senderId = client.data.user.sub;

        const message = await this.prisma.message.create({
            data: {
                text: data.text,
                senderId,
                receiverId: data.receiverId,
            },
        });

        this.server.emit('receive_message', message);
    }
}
