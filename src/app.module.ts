import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QuestionsModule } from './questions/questions.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChatModule } from './chat/chat.module';
import { RoutesModule } from './routes/routes.module';
import { PokemonModule } from './pokemon/pokemon.module';
import { SecurityModule } from './security/security.module';
import { PrivacyModule } from './privacy/privacy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env${process.env.NODE_ENV ? '.' + process.env.NODE_ENV : ''}`,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    QuestionsModule,
    ChatModule,
    RoutesModule,
    PokemonModule,
    SecurityModule,
    PrivacyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
