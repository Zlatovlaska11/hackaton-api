import { Controller, Get, Query } from '@nestjs/common';
import { QuestionsService } from './questions.service';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  async ask(@Query('question') question: string) {
    return this.questionsService.ask(question);
  }
}
