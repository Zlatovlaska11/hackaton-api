import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const prismaService = {
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    pokemon: {
      create: jest.fn(),
    },
    petType: {
      findUnique: jest.fn(),
    },
    friendRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a user with normalized pet fields', async () => {
    prismaService.petType.findUnique.mockResolvedValue({
      code: 'city',
    });
    prismaService.users.create.mockResolvedValue({
      userId: 9,
      username: 'john',
      password: 'hashed-password',
      petType: 'city',
      petName: 'Rex',
    });

    await service.create({
      username: 'john',
      password: 'secret',
      petType: '  CITY  ',
      petName: '  Rex  ',
    });

    expect(prismaService.petType.findUnique).toHaveBeenCalledWith({
      where: {
        code: 'city',
      },
      select: {
        code: true,
      },
    });
    expect(prismaService.users.create).toHaveBeenCalledWith({
      data: {
        username: 'john',
        password: expect.any(String),
        petType: 'city',
        petName: 'Rex',
      },
    });
    expect(prismaService.pokemon.create).toHaveBeenCalledWith({
      data: {
        userId: 9,
        name: 'Rex',
        behavior: 'City',
      },
    });
  });

  it('rejects unsupported pet types', async () => {
    prismaService.petType.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        username: 'john',
        password: 'secret',
        petType: 'fire',
      }),
    ).rejects.toThrow('petType must be one of: city, water, tree');
  });

  it('loads detailed user info with pet fields', async () => {
    prismaService.users.findUnique.mockResolvedValue({
      userId: 2,
      username: 'alice',
      petType: 'cat',
      petName: 'Luna',
      pokemon: [
        {
          id: 11,
          name: 'Luna',
          behavior: 'Tree',
        },
      ],
    });

    const result = await service.findUserInfoById(2);

    expect(prismaService.users.findUnique).toHaveBeenCalledWith({
      where: { userId: 2 },
      select: {
        userId: true,
        username: true,
        petType: true,
        petName: true,
        pokemon: {
          orderBy: {
            id: 'asc',
          },
          select: {
            id: true,
            name: true,
            behavior: true,
          },
        },
      },
    });
    expect(result).toEqual({
      userId: 2,
      username: 'alice',
      petType: 'cat',
      petName: 'Luna',
      pokemon: [
        {
          id: 11,
          name: 'Luna',
          behavior: 'Tree',
        },
      ],
    });
  });

  it('lists chat users excluding the current user', async () => {
    prismaService.users.findMany.mockResolvedValue([
      { userId: 2, username: 'alice' },
      { userId: 3, username: 'bob' },
    ]);

    const result = await service.listForChat(1, 'a', 200);

    expect(prismaService.users.findMany).toHaveBeenCalledWith({
      where: {
        userId: {
          not: 1,
        },
        username: {
          contains: 'a',
          mode: 'insensitive',
        },
      },
      orderBy: {
        username: 'asc',
      },
      take: 100,
      select: {
        userId: true,
        username: true,
      },
    });
    expect(result).toEqual([
      { userId: 2, username: 'alice' },
      { userId: 3, username: 'bob' },
    ]);
  });

  it('creates a friend request with a canonical user pair', async () => {
    prismaService.users.findUnique.mockResolvedValue({
      userId: 2,
      username: 'alice',
    });
    prismaService.friendRequest.findUnique.mockResolvedValue(null);
    prismaService.friendRequest.create.mockResolvedValue({
      id: 7,
      requesterId: 1,
      receiverId: 2,
      status: 'PENDING',
      createdAt: new Date('2026-03-20T19:35:00.000Z'),
      acceptedAt: null,
      requester: { userId: 1, username: 'john' },
      receiver: { userId: 2, username: 'alice' },
    });

    const result = await service.sendFriendRequest(1, 2);

    expect(prismaService.friendRequest.findUnique).toHaveBeenCalledWith({
      where: {
        pairUserAId_pairUserBId: {
          pairUserAId: 1,
          pairUserBId: 2,
        },
      },
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        requester: {
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
    expect(prismaService.friendRequest.create).toHaveBeenCalledWith({
      data: {
        requesterId: 1,
        receiverId: 2,
        pairUserAId: 1,
        pairUserBId: 2,
      },
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        requester: {
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
    expect(result).toMatchObject({
      id: 7,
      requesterId: 1,
      receiverId: 2,
      status: 'PENDING',
    });
  });

  it('accepts a pending friend request for the receiver', async () => {
    prismaService.friendRequest.findUnique.mockResolvedValue({
      id: 8,
      requesterId: 2,
      receiverId: 1,
      status: 'PENDING',
      createdAt: new Date('2026-03-20T19:40:00.000Z'),
      acceptedAt: null,
      requester: { userId: 2, username: 'alice' },
      receiver: { userId: 1, username: 'john' },
    });
    prismaService.friendRequest.update.mockResolvedValue({
      id: 8,
      requesterId: 2,
      receiverId: 1,
      status: 'ACCEPTED',
      createdAt: new Date('2026-03-20T19:40:00.000Z'),
      acceptedAt: new Date('2026-03-20T19:45:00.000Z'),
      requester: { userId: 2, username: 'alice' },
      receiver: { userId: 1, username: 'john' },
    });

    const result = await service.acceptFriendRequest(1, 8);

    expect(prismaService.friendRequest.update).toHaveBeenCalledWith({
      where: {
        id: 8,
      },
      data: {
        status: 'ACCEPTED',
        acceptedAt: expect.any(Date),
      },
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        requester: {
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
    expect(result).toMatchObject({
      id: 8,
      status: 'ACCEPTED',
    });
  });

  it('lists accepted friends as the opposite side of each friendship', async () => {
    prismaService.friendRequest.findMany.mockResolvedValue([
      {
        requester: { userId: 1, username: 'john' },
        receiver: { userId: 3, username: 'bob' },
        createdAt: new Date('2026-03-20T19:40:00.000Z'),
        acceptedAt: new Date('2026-03-20T19:50:00.000Z'),
      },
      {
        requester: { userId: 2, username: 'alice' },
        receiver: { userId: 1, username: 'john' },
        createdAt: new Date('2026-03-20T19:20:00.000Z'),
        acceptedAt: new Date('2026-03-20T19:30:00.000Z'),
      },
    ]);

    const result = await service.listFriends(1);

    expect(prismaService.friendRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: 1 }, { receiverId: 1 }],
      },
      select: {
        requester: {
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
        createdAt: true,
        acceptedAt: true,
      },
    });
    expect(result).toEqual([
      {
        userId: 2,
        username: 'alice',
        friendsSince: new Date('2026-03-20T19:30:00.000Z'),
      },
      {
        userId: 3,
        username: 'bob',
        friendsSince: new Date('2026-03-20T19:50:00.000Z'),
      },
    ]);
  });
});
