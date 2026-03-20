import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from './routes.service';

describe('RoutesService', () => {
  let service: RoutesService;

  const prismaService = {
    pokemon: {
      findFirst: jest.fn(),
    },
    route: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    point: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutesService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<RoutesService>(RoutesService);
  });

  it('creates a route for the selected pokemon and links created points', async () => {
    prismaService.pokemon.findFirst.mockResolvedValue({
      id: 7,
      name: 'Pearl',
      behavior: 'Water',
    });

    jest.spyOn(service as any, 'planTrip').mockResolvedValue({
      source: 'heuristic',
      bearing: 90,
      distanceRatio: 0.5,
      scenicCurve: 0.2,
      reason: 'test plan',
    });
    jest.spyOn(service as any, 'buildDestination').mockReturnValue({
      lat: 50.0873,
      lng: 14.4236,
    });
    jest.spyOn(service as any, 'generateRoutePoints').mockResolvedValue([
      { lat: 50.0871, lng: 14.4211 },
      { lat: 50.0872, lng: 14.4224 },
      { lat: 50.0873, lng: 14.4236 },
    ]);

    const tx = {
      route: {
        create: jest.fn().mockResolvedValue({
          id: 11,
          userId: 1,
          pokemonId: 7,
          ended: false,
          inProgress: false,
          donePercent: 0,
          createdAt: new Date('2026-03-21T10:00:00.000Z'),
          startedAt: null,
          endedAt: null,
          pokemon: {
            id: 7,
            name: 'Pearl',
            behavior: 'Water',
          },
        }),
      },
      point: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: 21,
            lat: 50.087,
            lng: 14.421,
            visited: false,
            previousPointId: null,
            nextPointId: null,
            routeId: 11,
          })
          .mockResolvedValueOnce({
            id: 22,
            lat: 50.0871,
            lng: 14.4211,
            visited: false,
            previousPointId: 21,
            nextPointId: null,
            routeId: 11,
          })
          .mockResolvedValueOnce({
            id: 23,
            lat: 50.0872,
            lng: 14.4224,
            visited: false,
            previousPointId: 22,
            nextPointId: null,
            routeId: 11,
          })
          .mockResolvedValueOnce({
            id: 24,
            lat: 50.0873,
            lng: 14.4236,
            visited: false,
            previousPointId: 23,
            nextPointId: null,
            routeId: 11,
          }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    prismaService.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    const result = await service.createPath(1, {
      point: { lat: 50.087, lng: 14.421 },
      distanceMeters: 1200,
      pokemonId: 7,
    });

    expect(prismaService.pokemon.findFirst).toHaveBeenCalledWith({
      where: {
        id: 7,
        userId: 1,
      },
      select: {
        id: true,
        name: true,
        behavior: true,
      },
    });
    expect(tx.route.create).toHaveBeenCalledWith({
      data: {
        userId: 1,
        pokemonId: 7,
      },
      select: expect.any(Object),
    });
    expect(tx.point.create).toHaveBeenNthCalledWith(1, {
      data: {
        lat: 50.087,
        lng: 14.421,
        routeId: 11,
        previousPointId: null,
      },
      select: expect.any(Object),
    });
    expect(tx.point.create).toHaveBeenNthCalledWith(2, {
      data: {
        lat: 50.0871,
        lng: 14.4211,
        routeId: 11,
        previousPointId: 21,
      },
      select: expect.any(Object),
    });
    expect(tx.point.update).toHaveBeenCalledWith({
      where: {
        id: 21,
      },
      data: {
        nextPointId: 22,
      },
    });
    expect(result.route.id).toBe(11);
    expect(result.points.map((point) => point.id)).toEqual([21, 22, 23, 24]);
    expect(result.planner).toEqual({
      source: 'heuristic',
      reason: 'test plan',
    });
  });

  it('returns route points in chain order', async () => {
    prismaService.route.findFirst.mockResolvedValue({
      id: 11,
      userId: 1,
      pokemonId: 7,
      ended: false,
      inProgress: false,
      donePercent: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      startedAt: null,
      endedAt: null,
      pokemon: {
        id: 7,
        name: 'Pearl',
        behavior: 'Water',
      },
    });
    prismaService.point.findMany.mockResolvedValue([
      {
        id: 32,
        lat: 50.0872,
        lng: 14.422,
        visited: false,
        previousPointId: 31,
        nextPointId: 33,
        routeId: 11,
      },
      {
        id: 33,
        lat: 50.0873,
        lng: 14.423,
        visited: false,
        previousPointId: 32,
        nextPointId: null,
        routeId: 11,
      },
      {
        id: 31,
        lat: 50.087,
        lng: 14.421,
        visited: false,
        previousPointId: null,
        nextPointId: 32,
        routeId: 11,
      },
    ]);

    const result = await service.getPoints(1, 11);

    expect(result.points.map((point) => point.id)).toEqual([31, 32, 33]);
  });

  it('starts a route by marking it in progress', async () => {
    prismaService.route.findFirst.mockResolvedValue({
      id: 11,
      userId: 1,
      pokemonId: 7,
      ended: false,
      inProgress: false,
      donePercent: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      startedAt: null,
      endedAt: null,
      pokemon: {
        id: 7,
        name: 'Pearl',
        behavior: 'Water',
      },
    });
    prismaService.route.update.mockResolvedValue({
      id: 11,
      userId: 1,
      pokemonId: 7,
      ended: false,
      inProgress: true,
      donePercent: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      startedAt: new Date('2026-03-21T10:05:00.000Z'),
      endedAt: null,
      pokemon: {
        id: 7,
        name: 'Pearl',
        behavior: 'Water',
      },
    });

    const result = await service.startPath(1, 11);

    expect(prismaService.route.update).toHaveBeenCalledWith({
      where: {
        id: 11,
      },
      data: {
        inProgress: true,
        ended: false,
        startedAt: expect.any(Date),
        endedAt: null,
      },
      select: expect.any(Object),
    });
    expect(result.inProgress).toBe(true);
  });

  it('checks the next unvisited point against the configured radius', async () => {
    prismaService.route.findFirst.mockResolvedValue({
      id: 11,
      userId: 1,
      pokemonId: 7,
      ended: false,
      inProgress: true,
      donePercent: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      startedAt: new Date('2026-03-21T10:05:00.000Z'),
      endedAt: null,
      pokemon: {
        id: 7,
        name: 'Pearl',
        behavior: 'Water',
      },
    });
    prismaService.point.findMany.mockResolvedValue([
      {
        id: 41,
        lat: 50.087,
        lng: 14.421,
        visited: true,
        previousPointId: null,
        nextPointId: 42,
        routeId: 11,
      },
      {
        id: 42,
        lat: 50.08705,
        lng: 14.42105,
        visited: false,
        previousPointId: 41,
        nextPointId: null,
        routeId: 11,
      },
    ]);

    const result = await service.isOnPoint(1, 11, {
      point: { lat: 50.08704, lng: 14.42103 },
    });

    expect(result.isOnPoint).toBe(true);
    expect(result.pointId).toBe(42);
    expect(result.radiusMeters).toBe(30);
  });
});
