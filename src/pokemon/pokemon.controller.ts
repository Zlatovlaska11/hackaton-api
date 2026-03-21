import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PokemonService } from './pokemon.service';

@UseGuards(JwtAuthGuard)
@Controller('pokemon')
export class PokemonController {
  constructor(private readonly pokemonService: PokemonService) {}

  @Post(['increaseStrenghLevel', 'increaseStrengthLevel'])
  async increaseStrengthLevel(
    @Request() req,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pokemonService.increaseStrengthLevel(
      req.user.userId,
      this.parsePositiveInteger(body.num, 'num must be a positive integer'),
    );
  }

  @Post('increaseIntelligenceLevel')
  async increaseIntelligenceLevel(
    @Request() req,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pokemonService.increaseIntelligenceLevel(
      req.user.userId,
      this.parsePositiveInteger(body.num, 'num must be a positive integer'),
    );
  }

  @Post(['increaseAggillityLevel', 'increaseAgilityLevel'])
  async increaseAgilityLevel(
    @Request() req,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pokemonService.increaseAgilityLevel(
      req.user.userId,
      this.parsePositiveInteger(body.num, 'num must be a positive integer'),
    );
  }

  @Post('increaseFriendshipLevel')
  async increaseFriendshipLevel(
    @Request() req,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pokemonService.increaseFriendshipLevel(
      req.user.userId,
      this.parsePositiveInteger(
        body.friendPokemonId ??
          body.pokemonId ??
          body.pokemon_id ??
          body.pokemonIdB ??
          body.pokemon_idB,
        'friendPokemonId must be a positive integer',
      ),
      this.parsePositiveInteger(body.num, 'num must be a positive integer'),
    );
  }

  @Post('makeChild')
  async makeChild(@Request() req, @Body() body: Record<string, unknown>) {
    return this.pokemonService.makeChild(
      req.user.userId,
      this.parsePositiveInteger(
        body.pokemonIdA ?? body.pokemon_idA,
        'pokemon_idA must be a positive integer',
      ),
      this.parsePositiveInteger(
        body.pokemonIdB ?? body.pokemon_idB,
        'pokemon_idB must be a positive integer',
      ),
    );
  }

  private parsePositiveInteger(value: unknown, message: string) {
    const parsedValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException(message);
    }

    return parsedValue;
  }
}
