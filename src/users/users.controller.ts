import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async listUsers(
    @Request() req,
    @Query('search') search?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.usersService.listForChat(req.user.userId, search, limit);
  }

  @Get('friends')
  async listFriends(@Request() req) {
    return this.usersService.listFriends(req.user.userId);
  }

  @Get('friends/requests')
  async listFriendRequests(@Request() req) {
    return this.usersService.listFriendRequests(req.user.userId);
  }

  @Post('friends/requests')
  async sendFriendRequest(
    @Request() req,
    @Body() body: Record<string, unknown>,
  ) {
    return this.usersService.sendFriendRequest(
      req.user.userId,
      Number(body.receiverId),
    );
  }

  @Post('friends/requests/:requestId/accept')
  async acceptFriendRequest(
    @Request() req,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    return this.usersService.acceptFriendRequest(req.user.userId, requestId);
  }

  @Get(':userId')
  async getUser(@Param('userId', ParseIntPipe) userId: number) {
    const user = await this.usersService.findUserInfoById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
