import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
  };
  const usersService = {
    findUserInfoById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes pet fields through registration', async () => {
    authService.register.mockResolvedValue({ access_token: 'token' });

    await controller.register({
      username: 'newuser',
      password: 'secret',
      petType: 'city',
      petName: 'Milo',
    });

    expect(authService.register).toHaveBeenCalledWith(
      'newuser',
      'secret',
      'city',
      'Milo',
    );
  });

  it('loads the authenticated profile from the database', async () => {
    usersService.findUserInfoById.mockResolvedValue({
      userId: 7,
      username: 'john',
      petType: 'city',
      petName: 'Rex',
    });

    const result = await controller.getProfile({
      user: {
        userId: 7,
      },
    });

    expect(usersService.findUserInfoById).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      userId: 7,
      username: 'john',
      petType: 'city',
      petName: 'Rex',
    });
  });

  it('loads /auth/me from the authenticated user id', async () => {
    usersService.findUserInfoById.mockResolvedValue({
      userId: 8,
      username: 'maria',
      petType: 'water',
      petName: 'Pearl',
    });

    const result = await controller.getMe({
      user: {
        userId: 8,
      },
    });

    expect(usersService.findUserInfoById).toHaveBeenCalledWith(8);
    expect(result).toEqual({
      userId: 8,
      username: 'maria',
      petType: 'water',
      petName: 'Pearl',
    });
  });
});
