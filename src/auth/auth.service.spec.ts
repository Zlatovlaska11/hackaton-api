import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    create: jest.fn(),
    findOne: jest.fn(),
    markUserActive: jest.fn(),
  };
  const jwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('registers a user with pet fields before issuing a token', async () => {
    usersService.create.mockResolvedValue({
      userId: 12,
      username: 'newuser',
    });
    jwtService.sign.mockReturnValue('jwt-token');

    const result = await service.register('newuser', 'secret', 'city', 'Rex');

    expect(usersService.create).toHaveBeenCalledWith({
      username: 'newuser',
      password: 'secret',
      petType: 'city',
      petName: 'Rex',
    });
    expect(usersService.markUserActive).toHaveBeenCalledWith(12);
    expect(result).toEqual({ access_token: 'jwt-token' });
  });
});
