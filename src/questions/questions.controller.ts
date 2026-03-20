import { Controller, Get, Query } from '@nestjs/common';
import { QuestionsService } from './questions.service'; //importuji service controlleru
import { NullableHeaders } from 'node_modules/openai/internal/headers.mjs';

@Controller('questions')
export class QuestionsController {
    constructor(private readonly questionsService: QuestionsService) { } //konstruktor classu (musí obsahovat)


    @Get()
    async ask(@Query('question') question: string) {
        return this.questionsService.ask(question);
    }

}

