import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Users } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async findOne(username: string): Promise<Users | null> {
    return this.prisma.users.findUnique({
      where: {
        username,
      },
    });
  }

  async create(data: { username: string; password: string }): Promise<Users> {
    return this.prisma.users.create({
      data,
    });
  }
}
