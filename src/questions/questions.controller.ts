import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuestionsService } from './questions.service';
import { RateLimit } from '../security/rate-limit.decorator';
import { RateLimitGuard } from '../security/rate-limit.guard';

@UseGuards(JwtAuthGuard)
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'user', limit: 20, windowMs: 10 * 60 * 1000 })
  @Post()
  async ask(@Request() req, @Body() body: Record<string, unknown>) {
    return this.questionsService.ask(
      req.user.userId,
      typeof body.question === 'string' ? body.question : '',
    );
  }
}
