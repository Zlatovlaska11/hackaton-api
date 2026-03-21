import { Test, TestingModule } from '@nestjs/testing';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

describe('RoutesController', () => {
  let controller: RoutesController;

  const routesService = {
    createPath: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoutesController],
      providers: [
        {
          provide: RoutesService,
          useValue: routesService,
        },
      ],
    }).compile();

    controller = module.get<RoutesController>(RoutesController);
  });

  it('accepts the legacy id_pokemona query parameter for route creation', async () => {
    routesService.createPath.mockResolvedValue({
      route: { id: 1 },
      points: [],
    });

    await controller.createPath(
      {
        user: {
          userId: 5,
        },
      },
      {
        point: '50.087,14.421',
        distance: '1200',
        id_pokemona: '7',
      },
    );

    expect(routesService.createPath).toHaveBeenCalledWith(5, {
      point: {
        lat: 50.087,
        lng: 14.421,
      },
      distanceMeters: 1200,
      pokemonId: 7,
    });
  });

  it('allows route creation without a pokemon id so the backend can auto-select one', async () => {
    routesService.createPath.mockResolvedValue({
      route: { id: 2 },
      points: [],
    });

    await controller.createPath(
      {
        user: {
          userId: 6,
        },
      },
      {
        point: '50.087,14.421',
        distance: '1200',
      },
    );

    expect(routesService.createPath).toHaveBeenCalledWith(6, {
      point: {
        lat: 50.087,
        lng: 14.421,
      },
      distanceMeters: 1200,
      pokemonId: undefined,
    });
  });
});
