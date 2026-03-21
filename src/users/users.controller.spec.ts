import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersService = {
    findPublicUserProfileById: jest.fn(),
    listNearbyUsers: jest.fn(),
    listForChat: jest.fn(),
    listFriends: jest.fn(),
    listFriendPositions: jest.fn(),
    listFriendRequests: jest.fn(),
    sendFriendRequest: jest.fn(),
    acceptFriendRequest: jest.fn(),
    addPokemon: jest.fn(),
    getPrivacySettings: jest.fn(),
    updatePrivacySettings: jest.fn(),
    exportUserData: jest.fn(),
    deleteAccount: jest.fn(),
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
    usersService.findPublicUserProfileById.mockResolvedValue({
      userId: 9,
      username: 'ivy',
      petType: 'tree',
      petName: 'Moss',
      xp: 31,
      pokemon: [],
    });

    const result = await controller.getUser(9);

    expect(usersService.findPublicUserProfileById).toHaveBeenCalledWith(9);
    expect(result).toEqual({
      userId: 9,
      username: 'ivy',
      petType: 'tree',
      petName: 'Moss',
      xp: 31,
      pokemon: [],
    });
  });

  it('throws when the user does not exist', async () => {
    usersService.findPublicUserProfileById.mockResolvedValue(null);

    await expect(controller.getUser(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
