import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Behavior, Prisma, Users } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const EARTH_RADIUS_METERS = 6371000;

const userSummarySelect = {
  userId: true,
  username: true,
} as const;

const pokemonStatsSelect = {
  agility: true,
  intelligence: true,
  strength: true,
} as const;

const pokemonSummarySelect = {
  id: true,
  name: true,
  behavior: true,
  stats: {
    select: pokemonStatsSelect,
  },
} as const;

const userInfoSelect = {
  ...userSummarySelect,
  petType: true,
  petName: true,
  lastKnownLat: true,
  lastKnownLng: true,
  lastSeenAt: true,
  pokemon: {
    select: pokemonSummarySelect,
  },
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

type PrismaWriteClient = PrismaService | Prisma.TransactionClient;
type RawPokemonSummary = Prisma.PokemonGetPayload<{
  select: typeof pokemonSummarySelect;
}>;
type RawUserInfo = Prisma.UsersGetPayload<{
  select: typeof userInfoSelect;
}>;

export type UserSummary = {
  userId: number;
  username: string;
};

export type GpsPoint = {
  lat: number;
  lng: number;
};

export type PokemonStatsSummary = {
  agility: number;
  intelligence: number;
  strength: number;
};

export type PokemonSummary = {
  id: number;
  name: string;
  behavior: Behavior;
  stats: PokemonStatsSummary | null;
};

export type UserInfo = UserSummary & {
  petType: string | null;
  petName: string | null;
  lastKnownLocation: GpsPoint | null;
  lastSeenAt: Date | null;
  isOnline: boolean;
  pokemon: PokemonSummary[];
};

export type NearbyUserSummary = UserInfo & {
  distanceMeters: number;
};

export type ChatUserSummary = UserSummary;

export type FriendSummary = UserSummary & {
  friendsSince: Date;
};

export type FriendLocationSummary = UserSummary & {
  point: GpsPoint;
  lastSeenAt: Date | null;
  isOnline: boolean;
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
    const petName = this.normalizeOptionalString(data.petName);

    const user = await this.prisma.users.create({
      data: {
        username: data.username,
        password: hashedPassword,
        petType,
        petName,
      },
    });

    if (petType) {
      await this.createPokemonForUser(this.prisma, {
        userId: user.userId,
        name: petName ?? `${data.username}'s companion`,
        behavior: this.mapPetTypeToBehavior(petType),
      });
    }

    return user;
  }

  async addPokemon(
    userId: number,
    input: {
      name?: string | null;
      behavior?: string | null;
      petType?: string | null;
    },
  ): Promise<UserInfo> {
    const user = await this.prisma.users.findUnique({
      where: { userId },
      select: {
        userId: true,
        username: true,
        petType: true,
        petName: true,
        pokemon: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.pokemon) {
      throw new ConflictException('User already has a pokemon');
    }

    const resolvedPokemon = await this.resolvePokemonIdentity({
      behavior: input.behavior,
      petType: input.petType ?? user.petType,
    });
    const pokemonName =
      this.normalizeOptionalString(input.name) ??
      user.petName ??
      `${user.username}'s companion`;

    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: {
          userId,
        },
        data: {
          petName: pokemonName,
          petType: resolvedPokemon.petType,
        },
      });

      await this.createPokemonForUser(tx, {
        userId,
        name: pokemonName,
        behavior: resolvedPokemon.behavior,
      });
    });

    const updatedUser = await this.findUserInfoById(userId);

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return updatedUser;
  }

  async markUserActive(userId: number) {
    await this.prisma.users.updateMany({
      where: {
        userId,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  async recordUserLocation(userId: number, point: GpsPoint) {
    await this.prisma.users.updateMany({
      where: {
        userId,
      },
      data: {
        lastKnownLat: point.lat,
        lastKnownLng: point.lng,
        lastSeenAt: new Date(),
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
    const user = await this.prisma.users.findUnique({
      where: { userId },
      select: userInfoSelect,
    });

    return user ? this.mapUserInfo(user) : null;
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

  async listNearbyUsers(
    currentUserId: number,
    radiusMeters: number,
    options?: {
      status?: string;
      search?: string;
      limit?: number;
    },
  ): Promise<NearbyUserSummary[]> {
    const normalizedRadius = this.normalizeRadius(radiusMeters);
    const normalizedLimit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const normalizedSearch = options?.search?.trim();
    const normalizedStatus = this.normalizePresenceStatus(options?.status);
    const currentUser = await this.prisma.users.findUnique({
      where: {
        userId: currentUserId,
      },
      select: {
        lastKnownLat: true,
        lastKnownLng: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const currentUserPoint = this.getLocation(currentUser);

    if (!currentUserPoint) {
      throw new BadRequestException(
        'Current user does not have a last known location yet',
      );
    }

    const users = await this.prisma.users.findMany({
      where: {
        userId: {
          not: currentUserId,
        },
        lastKnownLat: {
          not: null,
        },
        lastKnownLng: {
          not: null,
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
      select: userInfoSelect,
    });

    return users
      .map((user) => {
        const userPoint = this.getLocation(user);

        if (!userPoint) {
          return null;
        }

        const isOnline = this.isOnline(user.lastSeenAt);

        if (!this.matchesPresenceFilter(normalizedStatus, isOnline)) {
          return null;
        }

        const distanceMeters = this.roundDistance(
          this.distanceBetweenMeters(currentUserPoint, userPoint),
        );

        if (distanceMeters > normalizedRadius) {
          return null;
        }

        return {
          ...this.mapUserInfo(user),
          distanceMeters,
        };
      })
      .filter((user): user is NearbyUserSummary => user !== null)
      .sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters ||
          left.username.localeCompare(right.username),
      )
      .slice(0, normalizedLimit);
  }

  async listFriendPositions(
    currentUserId: number,
  ): Promise<FriendLocationSummary[]> {
    const friends = await this.listFriends(currentUserId);

    if (!friends.length) {
      return [];
    }

    const friendsById = new Map(
      friends.map((friend) => [friend.userId, friend]),
    );
    const users = await this.prisma.users.findMany({
      where: {
        userId: {
          in: friends.map((friend) => friend.userId),
        },
        lastKnownLat: {
          not: null,
        },
        lastKnownLng: {
          not: null,
        },
      },
      select: {
        ...userSummarySelect,
        lastKnownLat: true,
        lastKnownLng: true,
        lastSeenAt: true,
      },
    });

    return users
      .map((user) => {
        const point = this.getLocation(user);

        if (!point) {
          return null;
        }

        return {
          userId: user.userId,
          username: friendsById.get(user.userId)?.username ?? user.username,
          point,
          lastSeenAt: user.lastSeenAt,
          isOnline: this.isOnline(user.lastSeenAt),
        };
      })
      .filter((user): user is FriendLocationSummary => user !== null)
      .sort(
        (left, right) =>
          Number(right.isOnline) - Number(left.isOnline) ||
          left.username.localeCompare(right.username),
      );
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

  private async createPokemonForUser(
    prisma: PrismaWriteClient,
    input: {
      userId: number;
      name: string;
      behavior: Behavior;
    },
  ) {
    return prisma.pokemon.create({
      data: {
        userId: input.userId,
        name: input.name,
        behavior: input.behavior,
        stats: {
          create: {},
        },
      },
      select: pokemonSummarySelect,
    });
  }

  private mapUserInfo(user: RawUserInfo): UserInfo {
    return {
      userId: user.userId,
      username: user.username,
      petType: user.petType,
      petName: user.petName,
      lastKnownLocation: this.getLocation(user),
      lastSeenAt: user.lastSeenAt,
      isOnline: this.isOnline(user.lastSeenAt),
      pokemon: user.pokemon ? [this.mapPokemon(user.pokemon)] : [],
    };
  }

  private mapPokemon(pokemon: RawPokemonSummary): PokemonSummary {
    return {
      id: pokemon.id,
      name: pokemon.name,
      behavior: pokemon.behavior,
      stats: pokemon.stats
        ? {
            agility: pokemon.stats.agility,
            intelligence: pokemon.stats.intelligence,
            strength: pokemon.stats.strength,
          }
        : null,
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

  private async resolvePokemonIdentity(input: {
    behavior?: string | null;
    petType?: string | null;
  }) {
    const normalizedBehavior = this.normalizeBehavior(input.behavior);
    const normalizedPetType = await this.normalizePetType(input.petType);

    if (!normalizedBehavior && !normalizedPetType) {
      throw new BadRequestException(
        'behavior or petType must be one of: city, water, tree',
      );
    }

    if (!normalizedBehavior) {
      return {
        petType: normalizedPetType!,
        behavior: this.mapPetTypeToBehavior(normalizedPetType!),
      };
    }

    const derivedPetType = this.mapBehaviorToPetType(normalizedBehavior);

    if (normalizedPetType && normalizedPetType !== derivedPetType) {
      throw new BadRequestException(
        'behavior and petType must describe the same pokemon type',
      );
    }

    return {
      behavior: normalizedBehavior,
      petType: normalizedPetType ?? derivedPetType,
    };
  }

  private normalizeBehavior(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value)?.toLowerCase();

    switch (normalizedValue) {
      case 'tree':
        return Behavior.Tree;
      case 'water':
        return Behavior.Water;
      case 'city':
        return Behavior.City;
      default:
        return null;
    }
  }

  private mapPetTypeToBehavior(petType: string): Behavior {
    switch (petType) {
      case 'tree':
        return Behavior.Tree;
      case 'water':
        return Behavior.Water;
      case 'city':
        return Behavior.City;
      default:
        throw new BadRequestException(
          'petType must be one of: city, water, tree',
        );
    }
  }

  private mapBehaviorToPetType(behavior: Behavior) {
    switch (behavior) {
      case Behavior.Tree:
        return 'tree';
      case Behavior.Water:
        return 'water';
      case Behavior.City:
        return 'city';
      default:
        throw new BadRequestException(
          'behavior must be one of: city, water, tree',
        );
    }
  }

  private normalizeRadius(radiusMeters: number) {
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      throw new BadRequestException('radius must be a positive number');
    }

    return radiusMeters;
  }

  private normalizePresenceStatus(status?: string) {
    const normalizedStatus = status?.trim().toLowerCase();

    if (!normalizedStatus || normalizedStatus === 'all') {
      return 'all';
    }

    if (normalizedStatus === 'online' || normalizedStatus === 'offline') {
      return normalizedStatus;
    }

    throw new BadRequestException(
      'status must be one of: all, online, offline',
    );
  }

  private matchesPresenceFilter(
    status: 'all' | 'online' | 'offline',
    isOnline: boolean,
  ) {
    switch (status) {
      case 'online':
        return isOnline;
      case 'offline':
        return !isOnline;
      case 'all':
      default:
        return true;
    }
  }

  private getLocation(user: {
    lastKnownLat: number | null;
    lastKnownLng: number | null;
  }): GpsPoint | null {
    if (
      typeof user.lastKnownLat !== 'number' ||
      typeof user.lastKnownLng !== 'number'
    ) {
      return null;
    }

    return {
      lat: user.lastKnownLat,
      lng: user.lastKnownLng,
    };
  }

  private isOnline(lastSeenAt: Date | null) {
    if (!lastSeenAt) {
      return false;
    }

    return Date.now() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
  }

  private distanceBetweenMeters(start: GpsPoint, end: GpsPoint) {
    const latDistance = this.toRadians(end.lat - start.lat);
    const lngDistance = this.toRadians(end.lng - start.lng);
    const startLat = this.toRadians(start.lat);
    const endLat = this.toRadians(end.lat);
    const haversine =
      Math.sin(latDistance / 2) ** 2 +
      Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDistance / 2) ** 2;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
  }

  private roundDistance(distanceMeters: number) {
    return Math.round(distanceMeters * 100) / 100;
  }

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }
}
