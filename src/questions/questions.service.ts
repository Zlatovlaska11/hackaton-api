import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { UsersService } from '../users/users.service';

@Injectable()
export class QuestionsService {
  private client: OpenAI | null = null;
  private readonly model =
    process.env.QUESTIONS_AI_MODEL?.trim() || 'gpt-5-mini';

  constructor(private readonly usersService: UsersService) {}

  async ask(userId: number, question: string) {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('question is required');
    }

    const canUseExternalAi = await this.usersService.canUseExternalAi(userId);

    if (!canUseExternalAi) {
      throw new ForbiddenException(
        'External AI processing is disabled for this account',
      );
    }

    const response = await this.getClient().responses.create({
      model: this.model,
      input: `Give exactly 10 short bullet steps for learning this topic. Return plain JSON with a single "steps" array of 10 short strings. Topic: ${normalizedQuestion}`,
    });

    return {
      content: response.output_text,
      usedAi: true,
      provider: 'openai',
      model: this.model,
    };
  }

  private getClient() {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    this.client = new OpenAI({ apiKey });
    return this.client;
  }
}
