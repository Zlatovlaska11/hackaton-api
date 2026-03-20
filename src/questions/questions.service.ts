import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class QuestionsService {
    private client = new OpenAI({ //připojuji se na OpenAI
        apiKey: process.env.OPENAI_API_KEY,
    });

    async ask(question: string) {
        const response = await this.client.chat.completions.create({
            model: 'o1',
            messages: [
                {role: 'user', content: `Give me exactly 10 short bullet steps how to learn (10 steps - like in duolingo) ${question}.
            Respond ONLY in valid JSON:
            ` + question}
            ]
        })
        return(response.choices[0].message.content);
    }
}