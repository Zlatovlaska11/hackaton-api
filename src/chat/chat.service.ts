import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async createMessage(senderId: number, receiverId: number, text: string) {
    if (!Number.isInteger(receiverId) || receiverId <= 0) {
      throw new BadRequestException('A valid receiverId is required');
    }

    if (senderId === receiverId) {
      throw new BadRequestException('You cannot send a message to yourself');
    }

    const normalizedText = text?.trim();

    if (!normalizedText) {
      throw new BadRequestException('Message text is required');
    }

    const receiver = await this.usersService.findById(receiverId);

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    return this.prisma.message.create({
      data: {
        text: normalizedText,
        senderId,
        receiverId,
      },
      select: {
        id: true,
        text: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
      },
    });
  }

  async getMessages(currentUserId: number, otherUserId: number, limit = 50) {
    const normalizedLimit = Math.min(Math.max(limit, 1), 200);

    if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
      throw new BadRequestException('A valid userId is required');
    }

    const otherUser = await this.usersService.findById(otherUserId);

    if (!otherUser) {
      throw new NotFoundException('User not found');
    }

    const messages = await this.prisma.message.findMany({
      where: {
        OR: [
          {
            senderId: currentUserId,
            receiverId: otherUserId,
          },
          {
            senderId: otherUserId,
            receiverId: currentUserId,
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: normalizedLimit,
      select: {
        id: true,
        text: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
      },
    });

    return {
      user: otherUser,
      messages: messages.reverse(),
    };
  }

  async listRecentConversations(currentUserId: number, limit = 20) {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const recentMessages = await this.prisma.message.findMany({
      where: {
        OR: [{ senderId: currentUserId }, { receiverId: currentUserId }],
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            userId: true,
            username: true,
          },
        },
        receiver: {
          select: {
            userId: true,
            username: true,
          },
        },
      },
    });

    const conversations = new Map<
      number,
      {
        user: { userId: number; username: string };
        lastMessage: {
          id: number;
          text: string;
          senderId: number;
          receiverId: number;
          createdAt: Date;
        };
      }
    >();

    for (const message of recentMessages) {
      const otherUser =
        message.senderId === currentUserId ? message.receiver : message.sender;

      if (conversations.has(otherUser.userId)) {
        continue;
      }

      conversations.set(otherUser.userId, {
        user: otherUser,
        lastMessage: {
          id: message.id,
          text: message.text,
          senderId: message.senderId,
          receiverId: message.receiverId,
          createdAt: message.createdAt,
        },
      });

      if (conversations.size >= normalizedLimit) {
        break;
      }
    }

    return Array.from(conversations.values());
  }
}
