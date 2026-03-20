import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;

  const prismaService = {
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const usersService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('creates a trimmed message for an existing receiver', async () => {
    usersService.findById.mockResolvedValue({ userId: 2, username: 'maria' });
    prismaService.message.create.mockResolvedValue({
      id: 10,
      text: 'Hello there',
      senderId: 1,
      receiverId: 2,
      createdAt: new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await service.createMessage(1, 2, '  Hello there  ');

    expect(prismaService.message.create).toHaveBeenCalledWith({
      data: {
        text: 'Hello there',
        senderId: 1,
        receiverId: 2,
      },
      select: {
        id: true,
        text: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
      },
    });
    expect(result.text).toBe('Hello there');
  });

  it('rejects invalid receiver ids', async () => {
    await expect(
      service.createMessage(1, Number.NaN, 'hello'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing receivers', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(service.createMessage(1, 999, 'hello')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the latest messages in ascending order', async () => {
    usersService.findById.mockResolvedValue({ userId: 2, username: 'maria' });
    prismaService.message.findMany.mockResolvedValue([
      {
        id: 2,
        text: 'second',
        senderId: 2,
        receiverId: 1,
        createdAt: new Date('2026-03-20T12:02:00.000Z'),
      },
      {
        id: 1,
        text: 'first',
        senderId: 1,
        receiverId: 2,
        createdAt: new Date('2026-03-20T12:01:00.000Z'),
      },
    ]);

    const result = await service.getMessages(1, 2, 50);

    expect(prismaService.message.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            senderId: 1,
            receiverId: 2,
          },
          {
            senderId: 2,
            receiverId: 1,
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      select: {
        id: true,
        text: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
      },
    });
    expect(result).toEqual({
      user: { userId: 2, username: 'maria' },
      messages: [
        {
          id: 1,
          text: 'first',
          senderId: 1,
          receiverId: 2,
          createdAt: new Date('2026-03-20T12:01:00.000Z'),
        },
        {
          id: 2,
          text: 'second',
          senderId: 2,
          receiverId: 1,
          createdAt: new Date('2026-03-20T12:02:00.000Z'),
        },
      ],
    });
  });
});
