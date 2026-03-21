import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersService = {
    findUserInfoById: jest.fn(),
    listNearbyUsers: jest.fn(),
    listForChat: jest.fn(),
    listFriends: jest.fn(),
    listFriendPositions: jest.fn(),
    listFriendRequests: jest.fn(),
    sendFriendRequest: jest.fn(),
    acceptFriendRequest: jest.fn(),
    addPokemon: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('loads detailed user info by id with xp', async () => {
    usersService.findUserInfoById.mockResolvedValue({
      userId: 9,
      username: 'ivy',
      petType: 'tree',
      petName: 'Moss',
      xp: 31,
      lastKnownLocation: {
        lat: 50.087,
        lng: 14.421,
      },
      lastSeenAt: null,
      isOnline: false,
      pokemon: [],
    });

    const result = await controller.getUser(9);

    expect(usersService.findUserInfoById).toHaveBeenCalledWith(9);
    expect(result).toEqual({
      userId: 9,
      username: 'ivy',
      petType: 'tree',
      petName: 'Moss',
      xp: 31,
      lastKnownLocation: {
        lat: 50.087,
        lng: 14.421,
      },
      lastSeenAt: null,
      isOnline: false,
      pokemon: [],
    });
  });

  it('throws when the user does not exist', async () => {
    usersService.findUserInfoById.mockResolvedValue(null);

    await expect(controller.getUser(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
