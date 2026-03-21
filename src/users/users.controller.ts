import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
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
    @Query('radius') radius?: string,
    @Query('status') status?: string,
  ) {
    const parsedRadius = this.parseOptionalPositiveNumber(
      radius,
      'radius must be a positive number',
    );

    if (parsedRadius !== undefined) {
      return this.usersService.listNearbyUsers(req.user.userId, parsedRadius, {
        search,
        limit,
        status,
      });
    }

    return this.usersService.listForChat(req.user.userId, search, limit);
  }

  @Get('friends')
  async listFriends(@Request() req) {
    return this.usersService.listFriends(req.user.userId);
  }

  @Get('friendsPos')
  async listFriendPositions(@Request() req) {
    return this.usersService.listFriendPositions(req.user.userId);
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

  @Post('addPokemon')
  async addPokemon(@Request() req, @Body() body: Record<string, unknown>) {
    return this.usersService.addPokemon(req.user.userId, {
      name: this.toOptionalString(body.name),
      behavior: this.toOptionalString(body.behavior),
      petType: this.toOptionalString(body.petType),
    });
  }

  @Get('privacy')
  async getPrivacy(@Request() req) {
    return this.usersService.getPrivacySettings(req.user.userId);
  }

  @Patch('privacy')
  async updatePrivacy(@Request() req, @Body() body: Record<string, unknown>) {
    return this.usersService.updatePrivacySettings(req.user.userId, {
      shareLocationWithFriends: this.toOptionalBoolean(
        body.shareLocationWithFriends,
      ),
      shareLocationPublicly: this.toOptionalBoolean(body.shareLocationPublicly),
      allowExternalAiProcessing: this.toOptionalBoolean(
        body.allowExternalAiProcessing,
      ),
    });
  }

  @Get('me/export')
  async exportMe(@Request() req) {
    return this.usersService.exportUserData(req.user.userId);
  }

  @Delete('me')
  async deleteMe(@Request() req) {
    return this.usersService.deleteAccount(req.user.userId);
  }

  @Get(':userId')
  async getUser(@Param('userId', ParseIntPipe) userId: number) {
    const user = await this.usersService.findPublicUserProfileById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private parseOptionalPositiveNumber(
    value: string | undefined,
    message: string,
  ) {
    if (value === undefined || value === null || value.trim() === '') {
      return undefined;
    }

    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException(message);
    }

    return parsedValue;
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
  }

  private toOptionalBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
  }
}
