import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoutesService } from './routes.service';
import { RateLimit } from '../security/rate-limit.decorator';
import { RateLimitGuard } from '../security/rate-limit.guard';

type GeoPoint = {
  lat: number;
  lng: number;
};

@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'user', limit: 30, windowMs: 5 * 60 * 1000 })
  @Post('create-path')
  async createPath(@Request() req, @Body() body: Record<string, unknown>) {
    return this.routesService.createPath(req.user.userId, {
      point: this.parsePoint(body.point),
      distanceMeters: this.parseDistanceMeters(body.distance),
      pokemonId: this.parseOptionalInteger(
        body.pokemonId ?? body.id_pokemona,
        'pokemonId must be a positive integer',
      ),
    });
  }

  @Get(':routeId/points')
  async getPoints(
    @Request() req,
    @Param('routeId', ParseIntPipe) routeId: number,
  ) {
    return this.routesService.getPoints(req.user.userId, routeId);
  }

  @Post(':routeId/start-path')
  async startPath(
    @Request() req,
    @Param('routeId', ParseIntPipe) routeId: number,
  ) {
    return this.routesService.startPath(req.user.userId, routeId);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'user', limit: 120, windowMs: 5 * 60 * 1000 })
  @Post(':routeId/is-on-point')
  async isOnPoint(
    @Request() req,
    @Param('routeId', ParseIntPipe) routeId: number,
    @Body() body: Record<string, unknown>,
  ) {
    const pointId = body.pointId
      ? this.parseInteger(body.pointId, 'pointId must be a positive integer')
      : undefined;

    return this.routesService.isOnPoint(req.user.userId, routeId, {
      point: this.parsePoint(body.point),
      pointId,
    });
  }

  @Post(':routeId/stop-path')
  async stopPath(
    @Request() req,
    @Param('routeId', ParseIntPipe) routeId: number,
  ) {
    return this.routesService.stopPath(req.user.userId, routeId);
  }

  private parsePoint(value: unknown): GeoPoint {
    if (value === undefined || value === null) {
      throw new BadRequestException(
        'point is required. Use "lat,lng", [lat, lng], or {"lat": ..., "lng": ...}',
      );
    }

    if (Array.isArray(value) && value.length >= 2) {
      return this.validatePoint({
        lat: Number(value[0]),
        lng: Number(value[1]),
      });
    }

    if (value && typeof value === 'object') {
      const point = value as {
        lat?: number;
        lng?: number;
        latitude?: number;
        longitude?: number;
      };

      return this.validatePoint({
        lat: Number(point.lat ?? point.latitude),
        lng: Number(point.lng ?? point.longitude),
      });
    }

    if (typeof value === 'string') {
      const trimmedValue = value.trim();

      try {
        return this.parsePoint(JSON.parse(trimmedValue));
      } catch {
        const pieces = trimmedValue
          .split(/[,\s;]+/)
          .map((piece) => piece.trim())
          .filter(Boolean);

        if (pieces.length >= 2) {
          return this.validatePoint({
            lat: Number(pieces[0]),
            lng: Number(pieces[1]),
          });
        }
      }
    }

    throw new BadRequestException(
      'point must be "lat,lng", [lat, lng], or {"lat": ..., "lng": ...}',
    );
  }

  private validatePoint(point: GeoPoint): GeoPoint {
    if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) {
      throw new BadRequestException('Latitude must be a valid number');
    }

    if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
      throw new BadRequestException('Longitude must be a valid number');
    }

    return point;
  }

  private parseDistanceMeters(value: unknown): number {
    if (value === undefined || value === null) {
      throw new BadRequestException('distance is required');
    }

    const normalizedValue =
      typeof value === 'number' ? String(value) : String(value).trim().toLowerCase();
    const matchedValue = normalizedValue.match(/^(-?\d+(?:\.\d+)?)\s*(km|m)?$/);

    if (!matchedValue) {
      throw new BadRequestException(
        'distance must be a number of meters, for example "1200" or "1.2km"',
      );
    }

    const numericValue = Number(matchedValue[1]);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new BadRequestException('distance must be greater than zero');
    }

    return matchedValue[2] === 'km' ? numericValue * 1000 : numericValue;
  }

  private parseInteger(value: unknown, message: string) {
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException(message);
    }

    return parsedValue;
  }

  private parseOptionalInteger(value: unknown, message: string) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return undefined;
    }

    return this.parseInteger(value, message);
  }
}
