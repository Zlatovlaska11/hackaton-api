import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Behavior } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

type GeoPoint = {
  lat: number;
  lng: number;
};

type CreatePathInput = {
  point: GeoPoint;
  distanceMeters: number;
  pokemonId: number;
};

type IsOnPointInput = {
  point: GeoPoint;
  pointId?: number;
};

type RoutePointRecord = {
  id: number;
  lat: number;
  lng: number;
  visited: boolean;
  previousPointId: number | null;
  nextPointId: number | null;
  routeId: number;
};

type PlannedTrip = {
  source: 'ai' | 'heuristic';
  bearing: number;
  distanceRatio: number;
  scenicCurve: number;
  reason: string;
};

const MIN_ROUTE_DISTANCE_METERS = 25;
const MAX_ROUTE_DISTANCE_METERS = 50000;
const DEFAULT_POINT_RADIUS_METERS = 30;
const DEFAULT_MAX_POINTS = 25;
const EARTH_RADIUS_METERS = 6371000;

const pokemonSummarySelect = {
  id: true,
  name: true,
  behavior: true,
} as const;

const routeSelect = {
  id: true,
  userId: true,
  pokemonId: true,
  ended: true,
  inProgress: true,
  donePercent: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  pokemon: {
    select: pokemonSummarySelect,
  },
} as const;

const pointSelect = {
  id: true,
  lat: true,
  lng: true,
  visited: true,
  previousPointId: true,
  nextPointId: true,
  routeId: true,
} as const;

@Injectable()
export class RoutesService {
  private readonly routeAiModel = process.env.ROUTE_AI_MODEL?.trim();
  private readonly openAiClient =
    process.env.OPENAI_API_KEY && this.routeAiModel
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : undefined;
  private readonly openRouteServiceApiKey =
    process.env.OPENROUTESERVICE_API_KEY?.trim();
  private readonly openRouteServiceProfile =
    process.env.OPENROUTESERVICE_PROFILE?.trim() || 'foot-walking';
  private readonly pointRadiusMeters = this.parsePositiveNumber(
    process.env.ROUTE_POINT_RADIUS_METERS,
    DEFAULT_POINT_RADIUS_METERS,
  );
  private readonly maxPersistedPoints = Math.max(
    2,
    Math.round(
      this.parsePositiveNumber(
        process.env.ROUTE_MAX_POINTS,
        DEFAULT_MAX_POINTS,
      ),
    ),
  );

  constructor(private readonly prisma: PrismaService) {}

  async createPath(userId: number, input: CreatePathInput) {
    const distanceMeters = this.normalizeRequestedDistance(input.distanceMeters);
    const pokemon = await this.prisma.pokemon.findFirst({
      where: {
        id: input.pokemonId,
        userId,
      },
      select: pokemonSummarySelect,
    });

    if (!pokemon) {
      throw new NotFoundException('Pokemon not found');
    }

    const plannedTrip = await this.planTrip(
      input.point,
      distanceMeters,
      pokemon.behavior,
      pokemon.id,
    );
    const destination = this.buildDestination(
      input.point,
      distanceMeters,
      plannedTrip,
    );
    const generatedPoints = await this.generateRoutePoints(
      input.point,
      destination,
      pokemon.behavior,
      plannedTrip.scenicCurve,
    );

    const points = this.normalizeGeneratedPoints(
      generatedPoints,
      input.point,
      destination,
    );

    const createdRoute = await this.prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          userId,
          pokemonId: pokemon.id,
        },
        select: routeSelect,
      });

      const createdPoints: RoutePointRecord[] = [];
      let previousPointId: number | null = null;

      for (const point of points) {
        const createdPoint = await tx.point.create({
          data: {
            lat: point.lat,
            lng: point.lng,
            routeId: route.id,
            previousPointId,
          },
          select: pointSelect,
        });

        if (previousPointId !== null) {
          await tx.point.update({
            where: {
              id: previousPointId,
            },
            data: {
              nextPointId: createdPoint.id,
            },
          });

          const previousPoint = createdPoints.at(-1);

          if (previousPoint) {
            previousPoint.nextPointId = createdPoint.id;
          }
        }

        createdPoints.push(createdPoint);
        previousPointId = createdPoint.id;
      }

      return {
        route,
        points: createdPoints,
      };
    });

    return {
      route: createdRoute.route,
      points: createdRoute.points,
      requestedDistanceMeters: distanceMeters,
      radiusMeters: this.pointRadiusMeters,
      destination,
      planner: {
        source: plannedTrip.source,
        reason: plannedTrip.reason,
      },
    };
  }

  async getPoints(userId: number, routeId: number) {
    const route = await this.getOwnedRouteOrThrow(userId, routeId);
    const points = await this.getOrderedRoutePoints(routeId);

    return {
      route,
      points,
    };
  }

  async startPath(userId: number, routeId: number) {
    const route = await this.getOwnedRouteOrThrow(userId, routeId);

    return this.prisma.route.update({
      where: {
        id: routeId,
      },
      data: {
        inProgress: true,
        ended: false,
        startedAt: route.startedAt ?? new Date(),
        endedAt: null,
      },
      select: routeSelect,
    });
  }

  async stopPath(userId: number, routeId: number) {
    await this.getOwnedRouteOrThrow(userId, routeId);

    return this.prisma.route.update({
      where: {
        id: routeId,
      },
      data: {
        inProgress: false,
        ended: true,
        endedAt: new Date(),
      },
      select: routeSelect,
    });
  }

  async isOnPoint(userId: number, routeId: number, input: IsOnPointInput) {
    const route = await this.getOwnedRouteOrThrow(userId, routeId);
    const orderedPoints = await this.getOrderedRoutePoints(routeId);

    if (!orderedPoints.length) {
      throw new NotFoundException('Route has no points');
    }

    const targetPoint = input.pointId
      ? orderedPoints.find((point) => point.id === input.pointId)
      : orderedPoints.find((point) => !point.visited) ??
        orderedPoints[orderedPoints.length - 1];

    if (!targetPoint) {
      throw new NotFoundException('Point not found on this route');
    }

    const distanceMeters = this.distanceBetweenMeters(input.point, targetPoint);

    return {
      routeId: route.id,
      pointId: targetPoint.id,
      isOnPoint: distanceMeters <= this.pointRadiusMeters,
      distanceMeters: Math.round(distanceMeters * 100) / 100,
      radiusMeters: this.pointRadiusMeters,
      checkedPoint: input.point,
      targetPoint: {
        lat: targetPoint.lat,
        lng: targetPoint.lng,
      },
    };
  }

  private async getOwnedRouteOrThrow(userId: number, routeId: number) {
    const route = await this.prisma.route.findFirst({
      where: {
        id: routeId,
        userId,
      },
      select: routeSelect,
    });

    if (!route) {
      throw new NotFoundException('Route not found');
    }

    return route;
  }

  private async getOrderedRoutePoints(routeId: number): Promise<RoutePointRecord[]> {
    const points = await this.prisma.point.findMany({
      where: {
        routeId,
      },
      select: pointSelect,
    });

    if (points.length <= 1) {
      return points;
    }

    const pointsById = new Map(points.map((point) => [point.id, point]));
    const orderedPoints: RoutePointRecord[] = [];
    const visited = new Set<number>();
    let currentPoint: RoutePointRecord | undefined =
      points.find((point) => point.previousPointId === null) ??
      [...points].sort((left, right) => left.id - right.id)[0];

    while (currentPoint && !visited.has(currentPoint.id)) {
      orderedPoints.push(currentPoint);
      visited.add(currentPoint.id);
      currentPoint = currentPoint.nextPointId
        ? pointsById.get(currentPoint.nextPointId)
        : undefined;
    }

    if (orderedPoints.length === points.length) {
      return orderedPoints;
    }

    return [
      ...orderedPoints,
      ...points
        .filter((point) => !visited.has(point.id))
        .sort((left, right) => left.id - right.id),
    ];
  }

  private normalizeRequestedDistance(distanceMeters: number) {
    if (!Number.isFinite(distanceMeters)) {
      throw new BadRequestException('distance must be a valid number');
    }

    if (distanceMeters < MIN_ROUTE_DISTANCE_METERS) {
      throw new BadRequestException(
        `distance must be at least ${MIN_ROUTE_DISTANCE_METERS} meters`,
      );
    }

    if (distanceMeters > MAX_ROUTE_DISTANCE_METERS) {
      throw new BadRequestException(
        `distance must not exceed ${MAX_ROUTE_DISTANCE_METERS} meters`,
      );
    }

    return distanceMeters;
  }

  private async planTrip(
    origin: GeoPoint,
    distanceMeters: number,
    behavior: Behavior,
    pokemonId: number,
  ): Promise<PlannedTrip> {
    const aiPlannedTrip = await this.tryPlanTripWithAi(
      origin,
      distanceMeters,
      behavior,
    );

    if (aiPlannedTrip) {
      return aiPlannedTrip;
    }

    return this.buildHeuristicTrip(origin, distanceMeters, behavior, pokemonId);
  }

  private async tryPlanTripWithAi(
    origin: GeoPoint,
    distanceMeters: number,
    behavior: Behavior,
  ): Promise<PlannedTrip | null> {
    if (!this.openAiClient || !this.routeAiModel) {
      return null;
    }

    try {
      const response = await this.openAiClient.chat.completions.create({
        model: this.routeAiModel,
        messages: [
          {
            role: 'system',
            content:
              'You design short exploration routes for virtual pets. Respond with a single JSON object only.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              behavior,
              origin,
              distanceMeters,
              constraints: {
                bearingRange: [0, 360],
                distanceRatioRange: [0.35, 0.95],
                scenicCurveRange: [-1, 1],
              },
              instruction:
                'Return JSON with keys bearing, distanceRatio, scenicCurve, reason. Do not include place names or extra text.',
            }),
          },
        ],
      });
      const content = response.choices[0]?.message?.content;

      if (typeof content !== 'string') {
        return null;
      }

      const parsed = JSON.parse(this.extractJsonObject(content)) as {
        bearing?: number;
        distanceRatio?: number;
        scenicCurve?: number;
        reason?: string;
      };

      return {
        source: 'ai',
        bearing: this.normalizeBearing(parsed.bearing ?? 0),
        distanceRatio: this.clampNumber(
          Number(parsed.distanceRatio ?? 0.75),
          0.35,
          0.95,
        ),
        scenicCurve: this.clampNumber(
          Number(parsed.scenicCurve ?? 0),
          -1,
          1,
        ),
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim()
            : `${behavior} pokemon chose a route style with AI guidance.`,
      };
    } catch {
      return null;
    }
  }

  private buildHeuristicTrip(
    origin: GeoPoint,
    distanceMeters: number,
    behavior: Behavior,
    pokemonId: number,
  ): PlannedTrip {
    const seed = this.makeSeed(origin, pokemonId);
    const routeBias = distanceMeters >= 1500 ? 1 : 0.7;

    switch (behavior) {
      case Behavior.Water:
        return {
          source: 'heuristic',
          bearing: this.normalizeBearing(105 + seed * 80 - 40),
          distanceRatio: this.clampNumber(0.62 + seed * 0.18, 0.4, 0.88),
          scenicCurve: this.clampNumber(0.75 * routeBias, -1, 1),
          reason:
            'Water pokemon prefers a smoother curved walk that feels like following a shoreline or riverbank.',
        };
      case Behavior.Tree:
        return {
          source: 'heuristic',
          bearing: this.normalizeBearing(25 + seed * 120 - 60),
          distanceRatio: this.clampNumber(0.58 + seed * 0.22, 0.4, 0.9),
          scenicCurve: this.clampNumber(-0.55 * routeBias, -1, 1),
          reason:
            'Tree pokemon prefers a wandering path that feels closer to parks and greener edges.',
        };
      case Behavior.City:
      default:
        return {
          source: 'heuristic',
          bearing: this.normalizeBearing(300 + seed * 70 - 35),
          distanceRatio: this.clampNumber(0.72 + seed * 0.18, 0.45, 0.95),
          scenicCurve: this.clampNumber(0.18 * routeBias, -1, 1),
          reason:
            'City pokemon prefers a brisk route that feels more direct and landmark-seeking.',
        };
    }
  }

  private buildDestination(
    origin: GeoPoint,
    distanceMeters: number,
    plannedTrip: PlannedTrip,
  ) {
    const plannedDistance = Math.max(
      MIN_ROUTE_DISTANCE_METERS,
      distanceMeters * plannedTrip.distanceRatio,
    );
    const destination = this.offsetPoint(
      origin,
      plannedDistance,
      plannedTrip.bearing,
    );

    if (
      !Number.isFinite(destination.lat) ||
      !Number.isFinite(destination.lng) ||
      Math.abs(destination.lat) > 90 ||
      Math.abs(destination.lng) > 180
    ) {
      return this.offsetPoint(origin, plannedDistance, 0);
    }

    return destination;
  }

  private async generateRoutePoints(
    origin: GeoPoint,
    destination: GeoPoint,
    behavior: Behavior,
    scenicCurve: number,
  ) {
    const routePoints = await this.tryGenerateRouteWithOpenRouteService(
      origin,
      destination,
    );

    if (routePoints) {
      return routePoints;
    }

    return this.buildFallbackRoute(origin, destination, behavior, scenicCurve);
  }

  private async tryGenerateRouteWithOpenRouteService(
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<GeoPoint[] | null> {
    if (!this.openRouteServiceApiKey) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.openrouteservice.org/v2/directions/${this.openRouteServiceProfile}/geojson`,
        {
          method: 'POST',
          headers: {
            Authorization: this.openRouteServiceApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            coordinates: [
              [origin.lng, origin.lat],
              [destination.lng, destination.lat],
            ],
          }),
        },
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        features?: Array<{
          geometry?: {
            coordinates?: number[][];
          };
        }>;
      };
      const coordinates = payload.features?.[0]?.geometry?.coordinates;

      if (!coordinates?.length) {
        return null;
      }

      return coordinates
        .filter(
          (coordinate): coordinate is [number, number] =>
            Array.isArray(coordinate) &&
            coordinate.length >= 2 &&
            Number.isFinite(coordinate[0]) &&
            Number.isFinite(coordinate[1]),
        )
        .map(([lng, lat]) => ({
          lat,
          lng,
        }));
    } catch {
      return null;
    }
  }

  private buildFallbackRoute(
    origin: GeoPoint,
    destination: GeoPoint,
    behavior: Behavior,
    scenicCurve: number,
  ) {
    const distanceMeters = this.distanceBetweenMeters(origin, destination);
    const totalPoints = Math.max(
      4,
      Math.min(12, Math.round(distanceMeters / 160) + 2),
    );
    const bearing = this.initialBearing(origin, destination);
    const perpendicularBearing = this.normalizeBearing(bearing + 90);
    const maxCurveMeters = Math.min(distanceMeters * 0.18, 140);
    const path: GeoPoint[] = [origin];

    for (let index = 1; index < totalPoints - 1; index += 1) {
      const progress = index / (totalPoints - 1);
      const anchorPoint = this.interpolatePoint(origin, destination, progress);
      const offsetMeters = this.computeLateralOffset(
        behavior,
        scenicCurve,
        progress,
        maxCurveMeters,
      );

      if (Math.abs(offsetMeters) < 2) {
        path.push(anchorPoint);
        continue;
      }

      path.push(
        this.offsetPoint(
          anchorPoint,
          Math.abs(offsetMeters),
          offsetMeters >= 0
            ? perpendicularBearing
            : this.normalizeBearing(perpendicularBearing + 180),
        ),
      );
    }

    path.push(destination);

    return path;
  }

  private computeLateralOffset(
    behavior: Behavior,
    scenicCurve: number,
    progress: number,
    maxCurveMeters: number,
  ) {
    const curveStrength = Math.max(0.15, Math.abs(scenicCurve));

    switch (behavior) {
      case Behavior.Water:
        return Math.sin(progress * Math.PI) * maxCurveMeters * curveStrength;
      case Behavior.Tree:
        return (
          Math.sin(progress * Math.PI * 3) *
          maxCurveMeters *
          0.75 *
          curveStrength
        );
      case Behavior.City:
      default:
        return (
          (progress < 0.5 ? 1 : -1) * maxCurveMeters * 0.3 * curveStrength
        );
    }
  }

  private normalizeGeneratedPoints(
    points: GeoPoint[],
    origin: GeoPoint,
    destination: GeoPoint,
  ) {
    const sanitizedPoints = [
      origin,
      ...points,
      destination,
    ].filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180,
    );

    const sampledPoints = this.samplePoints(sanitizedPoints, this.maxPersistedPoints);
    const deduplicatedPoints: GeoPoint[] = [];

    for (const point of sampledPoints) {
      const lastPoint = deduplicatedPoints.at(-1);

      if (
        !lastPoint ||
        this.distanceBetweenMeters(lastPoint, point) > 3
      ) {
        deduplicatedPoints.push(point);
      }
    }

    const firstPoint = deduplicatedPoints[0];
    const lastPoint = deduplicatedPoints.at(-1);

    if (!firstPoint || this.distanceBetweenMeters(firstPoint, origin) > 1) {
      deduplicatedPoints.unshift(origin);
    }

    if (!lastPoint || this.distanceBetweenMeters(lastPoint, destination) > 1) {
      deduplicatedPoints.push(destination);
    }

    return deduplicatedPoints;
  }

  private samplePoints(points: GeoPoint[], maxPoints: number) {
    if (points.length <= maxPoints) {
      return points;
    }

    const sampledPoints = [points[0]];
    const lastIndex = points.length - 1;
    const step = lastIndex / (maxPoints - 1);

    for (let index = 1; index < maxPoints - 1; index += 1) {
      sampledPoints.push(points[Math.round(step * index)]);
    }

    sampledPoints.push(points[lastIndex]);
    return sampledPoints;
  }

  private interpolatePoint(origin: GeoPoint, destination: GeoPoint, progress: number) {
    return {
      lat: origin.lat + (destination.lat - origin.lat) * progress,
      lng: origin.lng + (destination.lng - origin.lng) * progress,
    };
  }

  private distanceBetweenMeters(start: GeoPoint, end: GeoPoint) {
    const latDistance = this.toRadians(end.lat - start.lat);
    const lngDistance = this.toRadians(end.lng - start.lng);
    const startLat = this.toRadians(start.lat);
    const endLat = this.toRadians(end.lat);
    const haversine =
      Math.sin(latDistance / 2) ** 2 +
      Math.cos(startLat) *
        Math.cos(endLat) *
        Math.sin(lngDistance / 2) ** 2;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
  }

  private initialBearing(start: GeoPoint, end: GeoPoint) {
    const startLat = this.toRadians(start.lat);
    const endLat = this.toRadians(end.lat);
    const lngDelta = this.toRadians(end.lng - start.lng);
    const y = Math.sin(lngDelta) * Math.cos(endLat);
    const x =
      Math.cos(startLat) * Math.sin(endLat) -
      Math.sin(startLat) * Math.cos(endLat) * Math.cos(lngDelta);

    return this.normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
  }

  private offsetPoint(origin: GeoPoint, distanceMeters: number, bearingDegrees: number) {
    const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
    const bearingRadians = this.toRadians(bearingDegrees);
    const startLat = this.toRadians(origin.lat);
    const startLng = this.toRadians(origin.lng);
    const targetLat = Math.asin(
      Math.sin(startLat) * Math.cos(angularDistance) +
        Math.cos(startLat) *
          Math.sin(angularDistance) *
          Math.cos(bearingRadians),
    );
    const targetLng =
      startLng +
      Math.atan2(
        Math.sin(bearingRadians) *
          Math.sin(angularDistance) *
          Math.cos(startLat),
        Math.cos(angularDistance) -
          Math.sin(startLat) * Math.sin(targetLat),
      );

    return {
      lat: (targetLat * 180) / Math.PI,
      lng: ((targetLng * 180) / Math.PI + 540) % 360 - 180,
    };
  }

  private makeSeed(origin: GeoPoint, pokemonId: number) {
    const rawValue = Math.sin(
      origin.lat * 12.9898 + origin.lng * 78.233 + pokemonId * 0.3456,
    );

    return rawValue - Math.floor(rawValue);
  }

  private clampNumber(value: number, minValue: number, maxValue: number) {
    return Math.min(Math.max(value, minValue), maxValue);
  }

  private normalizeBearing(value: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return ((value % 360) + 360) % 360;
  }

  private parsePositiveNumber(value: string | undefined, fallback: number) {
    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return fallback;
    }

    return parsedValue;
  }

  private extractJsonObject(content: string) {
    const matchedObject = content.match(/\{[\s\S]*\}/);

    return matchedObject ? matchedObject[0] : content;
  }

  private toRadians(value: number) {
    return (value * Math.PI) / 180;
  }
}
