import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class QuestionsService {
  private client: OpenAI | null = null;

  async ask(question: string) {
    const response = await this.getClient().chat.completions.create({
      model: 'o1',
      messages: [
        {
          role: 'user',
          content: `Give me exactly 10 short bullet steps how to learn (10 steps - like in duolingo) ${question}.
            Respond ONLY in valid JSON:
            ${question}`,
        },
      ],
    });

    return response.choices[0].message.content;
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
