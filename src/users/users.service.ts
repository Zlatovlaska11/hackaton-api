import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Users } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const userSummarySelect = {
  userId: true,
  username: true,
} as const;

const userInfoSelect = {
  ...userSummarySelect,
  petType: true,
  petName: true,
} as const;

const friendRequestSelect = {
  id: true,
  requesterId: true,
  receiverId: true,
  status: true,
  createdAt: true,
  acceptedAt: true,
  requester: {
    select: userSummarySelect,
  },
  receiver: {
    select: userSummarySelect,
  },
} as const;

export type UserSummary = {
  userId: number;
  username: string;
};

export type UserInfo = UserSummary & {
  petType: string | null;
  petName: string | null;
};

export type ChatUserSummary = UserSummary;

export type FriendSummary = UserSummary & {
  friendsSince: Date;
};

export type FriendRequestListItem = {
  id: number;
  createdAt: Date;
  user: UserSummary;
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findOne(username: string): Promise<Users | null> {
    return this.prisma.users.findUnique({
      where: {
        username,
      },
    });
  }

  async create(data: {
    username: string;
    password: string;
    petType?: string | null;
    petName?: string | null;
  }): Promise<Users> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const petType = await this.normalizePetType(data.petType);

    return this.prisma.users.create({
      data: {
        username: data.username,
        password: hashedPassword,
        petType,
        petName: this.normalizeOptionalString(data.petName),
      },
    });
  }

  async findById(userId: number): Promise<ChatUserSummary | null> {
    return this.prisma.users.findUnique({
      where: { userId },
      select: userSummarySelect,
    });
  }

  async findUserInfoById(userId: number): Promise<UserInfo | null> {
    return this.prisma.users.findUnique({
      where: { userId },
      select: userInfoSelect,
    });
  }

  async listForChat(
    currentUserId: number,
    search?: string,
    limit = 20,
  ): Promise<ChatUserSummary[]> {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const normalizedSearch = search?.trim();

    return this.prisma.users.findMany({
      where: {
        userId: {
          not: currentUserId,
        },
        ...(normalizedSearch
          ? {
              username: {
                contains: normalizedSearch,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: {
        username: 'asc',
      },
      take: normalizedLimit,
      select: userSummarySelect,
    });
  }

  async sendFriendRequest(requesterId: number, receiverId: number) {
    if (!Number.isInteger(receiverId) || receiverId <= 0) {
      throw new BadRequestException('A valid receiverId is required');
    }

    if (requesterId === receiverId) {
      throw new BadRequestException(
        'You cannot send a friend request to yourself',
      );
    }

    const receiver = await this.findById(receiverId);

    if (!receiver) {
      throw new NotFoundException('User not found');
    }

    const { pairUserAId, pairUserBId } = this.getPairUserIds(
      requesterId,
      receiverId,
    );

    const existingRequest = await this.prisma.friendRequest.findUnique({
      where: {
        pairUserAId_pairUserBId: {
          pairUserAId,
          pairUserBId,
        },
      },
      select: friendRequestSelect,
    });

    if (existingRequest) {
      if (existingRequest.status === 'ACCEPTED') {
        throw new ConflictException('You are already friends with this user');
      }

      if (existingRequest.requesterId === requesterId) {
        throw new ConflictException('Friend request already sent');
      }

      throw new ConflictException(
        'This user already sent you a friend request',
      );
    }

    return this.prisma.friendRequest.create({
      data: {
        requesterId,
        receiverId,
        pairUserAId,
        pairUserBId,
      },
      select: friendRequestSelect,
    });
  }

  async acceptFriendRequest(currentUserId: number, requestId: number) {
    const friendRequest = await this.prisma.friendRequest.findUnique({
      where: {
        id: requestId,
      },
      select: friendRequestSelect,
    });

    if (!friendRequest) {
      throw new NotFoundException('Friend request not found');
    }

    if (friendRequest.receiverId !== currentUserId) {
      throw new ForbiddenException(
        'You can only accept friend requests sent to you',
      );
    }

    if (friendRequest.status === 'ACCEPTED') {
      throw new ConflictException('Friend request already accepted');
    }

    return this.prisma.friendRequest.update({
      where: {
        id: requestId,
      },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
      select: friendRequestSelect,
    });
  }

  async listFriends(currentUserId: number): Promise<FriendSummary[]> {
    const friendships = await this.prisma.friendRequest.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: currentUserId }, { receiverId: currentUserId }],
      },
      select: {
        requester: {
          select: userSummarySelect,
        },
        receiver: {
          select: userSummarySelect,
        },
        createdAt: true,
        acceptedAt: true,
      },
    });

    return friendships
      .map((friendship) => {
        const friend =
          friendship.requester.userId === currentUserId
            ? friendship.receiver
            : friendship.requester;

        return {
          ...friend,
          friendsSince: friendship.acceptedAt ?? friendship.createdAt,
        };
      })
      .sort((left, right) => left.username.localeCompare(right.username));
  }

  async listFriendRequests(currentUserId: number): Promise<{
    incoming: FriendRequestListItem[];
    outgoing: FriendRequestListItem[];
  }> {
    const friendRequests = await this.prisma.friendRequest.findMany({
      where: {
        status: 'PENDING',
        OR: [{ requesterId: currentUserId }, { receiverId: currentUserId }],
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: friendRequestSelect,
    });

    return {
      incoming: friendRequests
        .filter((friendRequest) => friendRequest.receiverId === currentUserId)
        .map((friendRequest) => ({
          id: friendRequest.id,
          createdAt: friendRequest.createdAt,
          user: friendRequest.requester,
        })),
      outgoing: friendRequests
        .filter((friendRequest) => friendRequest.requesterId === currentUserId)
        .map((friendRequest) => ({
          id: friendRequest.id,
          createdAt: friendRequest.createdAt,
          user: friendRequest.receiver,
        })),
    };
  }

  private getPairUserIds(firstUserId: number, secondUserId: number) {
    return firstUserId < secondUserId
      ? {
          pairUserAId: firstUserId,
          pairUserBId: secondUserId,
        }
      : {
          pairUserAId: secondUserId,
          pairUserBId: firstUserId,
        };
  }

  private normalizeOptionalString(value?: string | null) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
  }

  private async normalizePetType(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value)?.toLowerCase();

    if (!normalizedValue) {
      return null;
    }

    const petType = await this.prisma.petType.findUnique({
      where: {
        code: normalizedValue,
      },
      select: {
        code: true,
      },
    });

    if (!petType) {
      throw new BadRequestException(
        'petType must be one of: city, water, tree',
      );
    }

    return petType.code;
  }
}
