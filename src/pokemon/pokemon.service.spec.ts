import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PokemonService } from './pokemon.service';

describe('PokemonService', () => {
  let service: PokemonService;

  const prismaService = {
    pokemon: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    pokemonStats: {
      upsert: jest.fn(),
    },
    friendRequest: {
      findUnique: jest.fn(),
    },
    pokemonFriendship: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    users: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PokemonService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<PokemonService>(PokemonService);
  });

  it('increases the strength level for the authenticated user pokemon', async () => {
    prismaService.pokemon.findFirst.mockResolvedValue({
      id: 7,
      userId: 1,
      name: 'Sprout',
      behavior: 'Tree',
      stats: {
        agility: 2,
        intelligence: 3,
        strength: 5,
      },
    });
    prismaService.pokemon.findUnique.mockResolvedValue({
      id: 7,
      userId: 1,
      name: 'Sprout',
      behavior: 'Tree',
      stats: {
        agility: 2,
        intelligence: 3,
        strength: 8,
      },
    });

    const result = await service.increaseStrengthLevel(1, 3);

    expect(prismaService.pokemonStats.upsert).toHaveBeenCalledWith({
      where: {
        pokemonId: 7,
      },
      update: {
        strength: {
          increment: 3,
        },
      },
      create: {
        pokemonId: 7,
        strength: 3,
      },
    });
    expect(result).toEqual({
      id: 7,
      userId: 1,
      name: 'Sprout',
      behavior: 'Tree',
      xp: 0,
      stats: {
        agility: 2,
        intelligence: 3,
        strength: 8,
      },
    });
  });

  it('increases friendship using a canonical pokemon pair', async () => {
    prismaService.pokemon.findFirst.mockResolvedValue({
      id: 9,
      userId: 1,
      name: 'Sprout',
      behavior: 'Tree',
      stats: {
        agility: 2,
        intelligence: 3,
        strength: 5,
      },
    });
    prismaService.pokemon.findUnique.mockResolvedValue({
      id: 4,
      userId: 2,
      name: 'Pearl',
      behavior: 'Water',
      stats: {
        agility: 4,
        intelligence: 6,
        strength: 2,
      },
    });
    prismaService.friendRequest.findUnique.mockResolvedValue({
      status: 'ACCEPTED',
    });
    prismaService.pokemonFriendship.upsert.mockResolvedValue({
      id: 3,
      pokemonAId: 4,
      pokemonBId: 9,
      friendship: 8,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
    });

    const result = await service.increaseFriendshipLevel(1, 4, 8);

    expect(prismaService.friendRequest.findUnique).toHaveBeenCalledWith({
      where: {
        pairUserAId_pairUserBId: {
          pairUserAId: 1,
          pairUserBId: 2,
        },
      },
      select: {
        status: true,
      },
    });
    expect(prismaService.pokemonFriendship.upsert).toHaveBeenCalledWith({
      where: {
        pokemonAId_pokemonBId: {
          pokemonAId: 4,
          pokemonBId: 9,
        },
      },
      update: {
        friendship: {
          increment: 8,
        },
      },
      create: {
        pokemonAId: 4,
        pokemonBId: 9,
        friendship: 8,
      },
      select: {
        id: true,
        pokemonAId: true,
        pokemonBId: true,
        friendship: true,
        createdAt: true,
      },
    });
    expect(result).toMatchObject({
      friendship: {
        id: 3,
        pokemonAId: 4,
        pokemonBId: 9,
        friendship: 8,
      },
      pokemon: {
        self: {
          id: 9,
        },
        friend: {
          id: 4,
        },
      },
    });
  });

  it('creates child pokemon by replacing both users existing pokemon data', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.75);

    prismaService.pokemon.findUnique
      .mockResolvedValueOnce({
        id: 11,
        userId: 1,
        name: 'Sprout',
        behavior: 'Tree',
        stats: {
          agility: 8,
          intelligence: 4,
          strength: 10,
        },
      })
      .mockResolvedValueOnce({
        id: 12,
        userId: 2,
        name: 'Pearl',
        behavior: 'Water',
        stats: {
          agility: 4,
          intelligence: 10,
          strength: 6,
        },
      });
    prismaService.friendRequest.findUnique.mockResolvedValue({
      status: 'ACCEPTED',
    });
    prismaService.pokemonFriendship.findUnique.mockResolvedValue({
      id: 30,
      pokemonAId: 11,
      pokemonBId: 12,
      friendship: 20,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
    });

    const tx = {
      pokemon: {
        update: jest.fn().mockResolvedValue(undefined),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            id: 11,
            userId: 1,
            name: 'Sprearl',
            behavior: 'Water',
            stats: {
              agility: 9,
              intelligence: 10,
              strength: 11,
            },
          })
          .mockResolvedValueOnce({
            id: 12,
            userId: 2,
            name: 'Pearout',
            behavior: 'Tree',
            stats: {
              agility: 9,
              intelligence: 10,
              strength: 11,
            },
          }),
      },
      pokemonStats: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      users: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      pokemonFriendship: {
        upsert: jest.fn().mockResolvedValue({
          id: 30,
          pokemonAId: 11,
          pokemonBId: 12,
          friendship: 21,
          createdAt: new Date('2026-03-21T10:00:00.000Z'),
        }),
      },
    };

    prismaService.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    const result = await service.makeChild(1, 11, 12);

    expect(tx.pokemon.update).toHaveBeenNthCalledWith(1, {
      where: {
        id: 11,
      },
      data: {
        name: 'Sprearl',
        behavior: 'Water',
      },
    });
    expect(tx.pokemon.update).toHaveBeenNthCalledWith(2, {
      where: {
        id: 12,
      },
      data: {
        name: 'Pearout',
        behavior: 'Tree',
      },
    });
    expect(tx.pokemonStats.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        pokemonId: 11,
      },
      update: {
        strength: 11,
        intelligence: 10,
        agility: 9,
      },
      create: {
        pokemonId: 11,
        strength: 11,
        intelligence: 10,
        agility: 9,
      },
    });
    expect(tx.pokemonStats.upsert).toHaveBeenNthCalledWith(2, {
      where: {
        pokemonId: 12,
      },
      update: {
        strength: 11,
        intelligence: 10,
        agility: 9,
      },
      create: {
        pokemonId: 12,
        strength: 11,
        intelligence: 10,
        agility: 9,
      },
    });
    expect(tx.users.update).toHaveBeenNthCalledWith(1, {
      where: {
        userId: 1,
      },
      data: {
        petName: 'Sprearl',
        petType: 'water',
      },
    });
    expect(tx.users.update).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 2,
      },
      data: {
        petName: 'Pearout',
        petType: 'tree',
      },
    });
    expect(result).toEqual({
      pokemons: [
        {
          id: 11,
          userId: 1,
          name: 'Sprearl',
          behavior: 'Water',
          xp: 0,
          stats: {
            agility: 9,
            intelligence: 10,
            strength: 11,
          },
        },
        {
          id: 12,
          userId: 2,
          name: 'Pearout',
          behavior: 'Tree',
          xp: 0,
          stats: {
            agility: 9,
            intelligence: 10,
            strength: 11,
          },
        },
      ],
      friendship: {
        id: 30,
        pokemonAId: 11,
        pokemonBId: 12,
        friendship: 21,
        createdAt: new Date('2026-03-21T10:00:00.000Z'),
      },
    });

    randomSpy.mockRestore();
  });
});
