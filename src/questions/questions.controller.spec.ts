import { Test, TestingModule } from '@nestjs/testing';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

describe('QuestionsController', () => {
  let controller: QuestionsController;
  const questionsService = {
    ask: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestionsController],
      providers: [
        {
          provide: QuestionsService,
          useValue: questionsService,
        },
      ],
    }).compile();

    controller = module.get<QuestionsController>(QuestionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the authenticated user id and body question to the service', async () => {
    questionsService.ask.mockResolvedValue({ content: 'ok' });

    const result = await controller.ask(
      {
        user: {
          userId: 4,
        },
      },
      {
        question: 'How do I train a cat?',
      },
    );

    expect(questionsService.ask).toHaveBeenCalledWith(
      4,
      'How do I train a cat?',
    );
    expect(result).toEqual({ content: 'ok' });
  });
});
