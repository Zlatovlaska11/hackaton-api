import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  async getConversations(
    @Request() req,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.chatService.listRecentConversations(req.user.userId, limit);
  }

  @Get('messages/:userId')
  async getMessages(
    @Request() req,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.chatService.getMessages(req.user.userId, userId, limit);
  }

  @Post('messages')
  async sendMessage(@Request() req, @Body() body: Record<string, unknown>) {
    return this.chatService.createMessage(
      req.user.userId,
      Number(body.receiverId),
      typeof body.text === 'string' ? body.text : '',
    );
  }
}
