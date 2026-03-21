import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Behavior, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const pokemonStatsSelect = {
  agility: true,
  intelligence: true,
  strength: true,
} as const;

const pokemonDetailSelect = {
  id: true,
  userId: true,
  name: true,
  behavior: true,
  xp: true,
  stats: {
    select: pokemonStatsSelect,
  },
} as const;

const pokemonFriendshipSelect = {
  id: true,
  pokemonAId: true,
  pokemonBId: true,
  friendship: true,
  createdAt: true,
} as const;

type RawPokemonDetail = Prisma.PokemonGetPayload<{
  select: typeof pokemonDetailSelect;
}>;
type RawPokemonFriendship = Prisma.PokemonFriendshipGetPayload<{
  select: typeof pokemonFriendshipSelect;
}>;
type PokemonStatField = 'strength' | 'intelligence' | 'agility';
type PokemonStatsValue = {
  strength: number;
  intelligence: number;
  agility: number;
};

export type PokemonDetailResponse = {
  id: number;
  userId: number;
  name: string;
  behavior: Behavior;
  xp: number;
  stats: PokemonStatsValue;
};

@Injectable()
export class PokemonService {
  constructor(private readonly prisma: PrismaService) {}

  async increaseStrengthLevel(currentUserId: number, num: number) {
    return this.increaseOwnPokemonStat(currentUserId, 'strength', num);
  }

  async increaseIntelligenceLevel(currentUserId: number, num: number) {
    return this.increaseOwnPokemonStat(currentUserId, 'intelligence', num);
  }

  async increaseAgilityLevel(currentUserId: number, num: number) {
    return this.increaseOwnPokemonStat(currentUserId, 'agility', num);
  }

  async increaseFriendshipLevel(
    currentUserId: number,
    friendPokemonId: number,
    num: number,
  ) {
    const normalizedNum = this.normalizePositiveInteger(
      num,
      'num must be a positive integer',
    );
    const ownPokemon = await this.findOwnedPokemonOrThrow(currentUserId);
    const friendPokemon = await this.findPokemonByIdOrThrow(friendPokemonId);

    if (ownPokemon.id === friendPokemon.id) {
      throw new BadRequestException(
        'friendPokemonId must belong to another pokemon',
      );
    }

    if (friendPokemon.userId === currentUserId) {
      throw new BadRequestException(
        'friendPokemonId must belong to another user',
      );
    }

    await this.ensureUsersAreFriends(currentUserId, friendPokemon.userId);
    const pair = this.getPokemonPairIds(ownPokemon.id, friendPokemon.id);
    const friendship = await this.prisma.pokemonFriendship.upsert({
      where: {
        pokemonAId_pokemonBId: pair,
      },
      update: {
        friendship: {
          increment: normalizedNum,
        },
      },
      create: {
        ...pair,
        friendship: normalizedNum,
      },
      select: pokemonFriendshipSelect,
    });

    return {
      friendship,
      pokemon: {
        self: this.mapPokemon(ownPokemon),
        friend: this.mapPokemon(friendPokemon),
      },
    };
  }

  async makeChild(
    currentUserId: number,
    pokemonIdA: number,
    pokemonIdB: number,
  ) {
    const normalizedPokemonIdA = this.normalizePositiveInteger(
      pokemonIdA,
      'pokemon_idA must be a positive integer',
    );
    const normalizedPokemonIdB = this.normalizePositiveInteger(
      pokemonIdB,
      'pokemon_idB must be a positive integer',
    );

    if (normalizedPokemonIdA === normalizedPokemonIdB) {
      throw new BadRequestException(
        'pokemon_idA and pokemon_idB must be different',
      );
    }

    const [pokemonA, pokemonB] = await Promise.all([
      this.findPokemonByIdOrThrow(normalizedPokemonIdA),
      this.findPokemonByIdOrThrow(normalizedPokemonIdB),
    ]);

    if (
      pokemonA.userId !== currentUserId &&
      pokemonB.userId !== currentUserId
    ) {
      throw new ForbiddenException(
        'You can only create a child with your own pokemon',
      );
    }

    if (pokemonA.userId === pokemonB.userId) {
      throw new BadRequestException(
        'A child can only be created between two different users',
      );
    }

    await this.ensureUsersAreFriends(pokemonA.userId, pokemonB.userId);
    const pair = this.getPokemonPairIds(pokemonA.id, pokemonB.id);
    const friendship = await this.prisma.pokemonFriendship.findUnique({
      where: {
        pokemonAId_pokemonBId: pair,
      },
      select: pokemonFriendshipSelect,
    });
    const currentFriendshipLevel = friendship?.friendship ?? 0;
    const childA = this.buildChildPokemon(
      pokemonA,
      pokemonB,
      currentFriendshipLevel,
    );
    const childB = this.buildChildPokemon(
      pokemonB,
      pokemonA,
      currentFriendshipLevel,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.pokemon.update({
        where: {
          id: pokemonA.id,
        },
        data: {
          name: childA.name,
          behavior: childA.behavior,
        },
      });
      await tx.pokemonStats.upsert({
        where: {
          pokemonId: pokemonA.id,
        },
        update: childA.stats,
        create: {
          pokemonId: pokemonA.id,
          ...childA.stats,
        },
      });
      await tx.users.update({
        where: {
          userId: pokemonA.userId,
        },
        data: {
          petName: childA.name,
          petType: this.mapBehaviorToPetType(childA.behavior),
        },
      });

      await tx.pokemon.update({
        where: {
          id: pokemonB.id,
        },
        data: {
          name: childB.name,
          behavior: childB.behavior,
        },
      });
      await tx.pokemonStats.upsert({
        where: {
          pokemonId: pokemonB.id,
        },
        update: childB.stats,
        create: {
          pokemonId: pokemonB.id,
          ...childB.stats,
        },
      });
      await tx.users.update({
        where: {
          userId: pokemonB.userId,
        },
        data: {
          petName: childB.name,
          petType: this.mapBehaviorToPetType(childB.behavior),
        },
      });

      const updatedFriendship = await tx.pokemonFriendship.upsert({
        where: {
          pokemonAId_pokemonBId: pair,
        },
        update: {
          friendship: {
            increment: 1,
          },
        },
        create: {
          ...pair,
          friendship: 1,
        },
        select: pokemonFriendshipSelect,
      });

      const [updatedPokemonA, updatedPokemonB] = await Promise.all([
        tx.pokemon.findUniqueOrThrow({
          where: {
            id: pokemonA.id,
          },
          select: pokemonDetailSelect,
        }),
        tx.pokemon.findUniqueOrThrow({
          where: {
            id: pokemonB.id,
          },
          select: pokemonDetailSelect,
        }),
      ]);

      return {
        pokemons: [
          this.mapPokemon(updatedPokemonA),
          this.mapPokemon(updatedPokemonB),
        ],
        friendship: updatedFriendship,
      };
    });
  }

  private async increaseOwnPokemonStat(
    currentUserId: number,
    field: PokemonStatField,
    num: number,
  ) {
    const normalizedNum = this.normalizePositiveInteger(
      num,
      'num must be a positive integer',
    );
    const pokemon = await this.findOwnedPokemonOrThrow(currentUserId);
    const updateData = {
      [field]: {
        increment: normalizedNum,
      },
    } as Prisma.PokemonStatsUpdateInput;
    const createData = {
      pokemonId: pokemon.id,
      [field]: normalizedNum,
    } as Prisma.PokemonStatsUncheckedCreateInput;

    await this.prisma.pokemonStats.upsert({
      where: {
        pokemonId: pokemon.id,
      },
      update: updateData,
      create: createData,
    });

    const updatedPokemon = await this.findPokemonByIdOrThrow(pokemon.id);
    return this.mapPokemon(updatedPokemon);
  }

  private async findOwnedPokemonOrThrow(currentUserId: number) {
    const pokemon = await this.prisma.pokemon.findFirst({
      where: {
        userId: currentUserId,
      },
      select: pokemonDetailSelect,
    });

    if (!pokemon) {
      throw new NotFoundException('Pokemon not found');
    }

    return pokemon;
  }

  private async findPokemonByIdOrThrow(pokemonId: number) {
    const pokemon = await this.prisma.pokemon.findUnique({
      where: {
        id: pokemonId,
      },
      select: pokemonDetailSelect,
    });

    if (!pokemon) {
      throw new NotFoundException('Pokemon not found');
    }

    return pokemon;
  }

  private async ensureUsersAreFriends(
    firstUserId: number,
    secondUserId: number,
  ) {
    const pair = this.getUserPairIds(firstUserId, secondUserId);
    const friendship = await this.prisma.friendRequest.findUnique({
      where: {
        pairUserAId_pairUserBId: pair,
      },
      select: {
        status: true,
      },
    });

    if (!friendship || friendship.status !== 'ACCEPTED') {
      throw new ForbiddenException(
        'Users must be friends before their pokemon can interact',
      );
    }
  }

  private buildChildPokemon(
    primaryPokemon: RawPokemonDetail,
    secondaryPokemon: RawPokemonDetail,
    friendshipLevel: number,
  ) {
    return {
      name: this.buildChildName(primaryPokemon.name, secondaryPokemon.name),
      behavior: this.pickBehavior(
        primaryPokemon.behavior,
        secondaryPokemon.behavior,
      ),
      stats: this.buildChildStats(
        this.getStats(primaryPokemon),
        this.getStats(secondaryPokemon),
        friendshipLevel,
      ),
    };
  }

  private buildChildStats(
    primaryStats: PokemonStatsValue,
    secondaryStats: PokemonStatsValue,
    friendshipLevel: number,
  ): PokemonStatsValue {
    const friendshipBonus = Math.min(4, Math.floor(friendshipLevel / 20));

    return {
      strength: this.mergeStat(
        primaryStats.strength,
        secondaryStats.strength,
        friendshipBonus,
      ),
      intelligence: this.mergeStat(
        primaryStats.intelligence,
        secondaryStats.intelligence,
        friendshipBonus,
      ),
      agility: this.mergeStat(
        primaryStats.agility,
        secondaryStats.agility,
        friendshipBonus,
      ),
    };
  }

  private mergeStat(
    primaryValue: number,
    secondaryValue: number,
    friendshipBonus: number,
  ) {
    const averageValue = Math.round((primaryValue + secondaryValue) / 2);
    const randomWindow =
      Math.max(2, Math.ceil(Math.abs(primaryValue - secondaryValue) / 2)) + 1;
    const randomOffset = Math.round((Math.random() * 2 - 1) * randomWindow);

    return Math.max(0, averageValue + friendshipBonus + randomOffset);
  }

  private buildChildName(primaryName: string, secondaryName: string) {
    const normalizedPrimary = primaryName.trim();
    const normalizedSecondary = secondaryName.trim();
    const prefixLength = Math.max(2, Math.ceil(normalizedPrimary.length / 2));
    const suffixStart = Math.max(
      0,
      Math.floor(normalizedSecondary.length / 2) - 1,
    );
    const mergedName = `${normalizedPrimary.slice(
      0,
      prefixLength,
    )}${normalizedSecondary.slice(suffixStart)}`.replace(/\s+/g, '');

    if (mergedName.length >= 3) {
      return mergedName.slice(0, 32);
    }

    return `${normalizedPrimary}-${normalizedSecondary}`.slice(0, 32);
  }

  private pickBehavior(primaryBehavior: Behavior, secondaryBehavior: Behavior) {
    if (primaryBehavior === secondaryBehavior) {
      return primaryBehavior;
    }

    return Math.random() < 0.5 ? primaryBehavior : secondaryBehavior;
  }

  private getStats(pokemon: RawPokemonDetail): PokemonStatsValue {
    return {
      strength: pokemon.stats?.strength ?? 0,
      intelligence: pokemon.stats?.intelligence ?? 0,
      agility: pokemon.stats?.agility ?? 0,
    };
  }

  private mapPokemon(pokemon: RawPokemonDetail): PokemonDetailResponse {
    return {
      id: pokemon.id,
      userId: pokemon.userId,
      name: pokemon.name,
      behavior: pokemon.behavior,
      xp: typeof pokemon.xp === 'number' ? pokemon.xp : 0,
      stats: this.getStats(pokemon),
    };
  }

  private getUserPairIds(firstUserId: number, secondUserId: number) {
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

  private getPokemonPairIds(firstPokemonId: number, secondPokemonId: number) {
    return firstPokemonId < secondPokemonId
      ? {
          pokemonAId: firstPokemonId,
          pokemonBId: secondPokemonId,
        }
      : {
          pokemonAId: secondPokemonId,
          pokemonBId: firstPokemonId,
        };
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

  private normalizePositiveInteger(value: number, message: string) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(message);
    }

    return value;
  }
}
