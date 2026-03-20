import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoutesService } from './routes.service';

type GeoPoint = {
  lat: number;
  lng: number;
};

@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get('create-path')
  async createPath(
    @Request() req,
    @Headers('point') pointHeader?: string,
    @Headers('distance') distanceHeader?: string,
    @Headers('id_pokemona') pokemonIdHeader?: string,
    @Query('point') pointQuery?: string,
    @Query('distance') distanceQuery?: string,
    @Query('pokemonId') pokemonIdQuery?: string,
  ) {
    return this.routesService.createPath(req.user.userId, {
      point: this.parsePoint(pointHeader ?? pointQuery),
      distanceMeters: this.parseDistanceMeters(distanceHeader ?? distanceQuery),
      pokemonId: this.parseInteger(
        pokemonIdHeader ?? pokemonIdQuery,
        'A valid pokemon id is required',
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

  @Get(':routeId/is-on-point')
  async isOnPoint(
    @Request() req,
    @Param('routeId', ParseIntPipe) routeId: number,
    @Headers('point') pointHeader?: string,
    @Query('point') pointQuery?: string,
    @Query('pointId') pointIdQuery?: string,
  ) {
    const pointId = pointIdQuery
      ? this.parseInteger(pointIdQuery, 'pointId must be a positive integer')
      : undefined;

    return this.routesService.isOnPoint(req.user.userId, routeId, {
      point: this.parsePoint(pointHeader ?? pointQuery),
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

  private parsePoint(value?: string): GeoPoint {
    if (!value) {
      throw new BadRequestException(
        'point is required. Use "lat,lng" or JSON {"lat": ..., "lng": ...}',
      );
    }

    const trimmedValue = value.trim();

    try {
      const parsed = JSON.parse(trimmedValue) as
        | [number, number]
        | {
            lat?: number;
            lng?: number;
            latitude?: number;
            longitude?: number;
          };

      if (Array.isArray(parsed) && parsed.length >= 2) {
        return this.validatePoint({
          lat: Number(parsed[0]),
          lng: Number(parsed[1]),
        });
      }

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return this.validatePoint({
          lat: Number(parsed.lat ?? parsed.latitude),
          lng: Number(parsed.lng ?? parsed.longitude),
        });
      }
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

    throw new BadRequestException(
      'point must be "lat,lng" or JSON {"lat": ..., "lng": ...}',
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

  private parseDistanceMeters(value?: string): number {
    if (!value) {
      throw new BadRequestException('distance is required');
    }

    const normalizedValue = value.trim().toLowerCase();
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

  private parseInteger(value: string | undefined, message: string) {
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException(message);
    }

    return parsedValue;
  }
}
