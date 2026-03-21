import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Behavior } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

type GeoPoint = {
  lat: number;
  lng: number;
};

type CreatePathInput = {
  point: GeoPoint;
  distanceMeters: number;
  pokemonId?: number;
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

type PlannedWaypoint = {
  progress: number;
  lateralOffsetRatio: number;
  note: string;
};

type PlannedTrip = {
  source: 'ai' | 'heuristic';
  bearing: number;
  distanceRatio: number;
  scenicCurve: number;
  reason: string;
  waypoints: PlannedWaypoint[];
};

type RoutedPathPlan = {
  destination: GeoPoint;
  distanceMeters: number;
  points: GeoPoint[];
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
  private readonly openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  private readonly routeAiModel =
    process.env.ROUTE_AI_MODEL?.trim() ||
    (this.openAiApiKey ? 'gpt-5-mini' : undefined);
  private readonly openAiClient = this.openAiApiKey
    ? new OpenAI({ apiKey: this.openAiApiKey })
    : undefined;
  private readonly openStreetMapBaseUrl =
    process.env.OSRM_BASE_URL?.trim().replace(/\/+$/, '') ||
    'https://router.project-osrm.org';
  private readonly openStreetMapProfile =
    process.env.OSRM_PROFILE?.trim() || 'foot';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async createPath(userId: number, input: CreatePathInput) {
    await this.usersService.recordUserLocation(userId, input.point);
    const distanceMeters = this.normalizeRequestedDistance(
      input.distanceMeters,
    );
    const pokemon = await this.findRoutePokemon(userId, input.pokemonId);

    if (!pokemon) {
      throw new NotFoundException('Pokemon not found');
    }

    const plannedTrip = await this.planTrip(
      input.point,
      distanceMeters,
      pokemon.behavior,
      pokemon.id,
    );
    const routedPath = await this.tryGenerateRouteWithOpenStreetMap(
      input.point,
      distanceMeters,
      plannedTrip,
    );
    const destination =
      routedPath?.destination ??
      this.buildDestination(input.point, distanceMeters, plannedTrip);
    const generatedPoints =
      routedPath?.points ??
      (await this.generateRoutePoints(
        input.point,
        destination,
        pokemon.behavior,
        plannedTrip,
      ));

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
    await this.usersService.recordUserLocation(userId, input.point);
    const route = await this.getOwnedRouteOrThrow(userId, routeId);
    const orderedPoints = await this.getOrderedRoutePoints(routeId);

    if (!orderedPoints.length) {
      throw new NotFoundException('Route has no points');
    }

    const targetPoint = input.pointId
      ? orderedPoints.find((point) => point.id === input.pointId)
      : (orderedPoints.find((point) => !point.visited) ??
        orderedPoints[orderedPoints.length - 1]);

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

  private async findRoutePokemon(userId: number, pokemonId?: number) {
    if (pokemonId) {
      return this.prisma.pokemon.findFirst({
        where: {
          id: pokemonId,
          userId,
        },
        select: pokemonSummarySelect,
      });
    }

    return this.prisma.pokemon.findFirst({
      where: {
        userId,
      },
      orderBy: {
        id: 'asc',
      },
      select: pokemonSummarySelect,
    });
  }

  private async getOrderedRoutePoints(
    routeId: number,
  ): Promise<RoutePointRecord[]> {
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
      const response = await this.openAiClient.responses.create({
        model: this.routeAiModel,
        instructions:
          'You design believable walking routes for virtual pets. Return only structured route-planning data that will later be turned into map points.',
        input: JSON.stringify({
          behavior,
          origin,
          distanceMeters,
          constraints: {
            bearingRange: [0, 360],
            distanceRatioRange: [0.45, 0.92],
            scenicCurveRange: [-1, 1],
            waypointLimit: 3,
            progressRange: [0.12, 0.88],
            lateralOffsetRatioRange: [-1, 1],
          },
          instruction:
            'Choose a destination direction and up to three intermediate waypoint hints that create a coherent walking route. Favor routes that feel natural and intentional for the pet behavior.',
        }),
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'route_plan',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'bearing',
                'distanceRatio',
                'scenicCurve',
                'reason',
                'waypoints',
              ],
              properties: {
                bearing: {
                  type: 'number',
                },
                distanceRatio: {
                  type: 'number',
                },
                scenicCurve: {
                  type: 'number',
                },
                reason: {
                  type: 'string',
                },
                waypoints: {
                  type: 'array',
                  maxItems: 3,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['progress', 'lateralOffsetRatio', 'note'],
                    properties: {
                      progress: {
                        type: 'number',
                      },
                      lateralOffsetRatio: {
                        type: 'number',
                      },
                      note: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const content = response.output_text;

      if (typeof content !== 'string') {
        return null;
      }

      const parsed = JSON.parse(this.extractJsonObject(content)) as {
        bearing?: number;
        distanceRatio?: number;
        scenicCurve?: number;
        reason?: string;
        waypoints?: Array<{
          progress?: number;
          lateralOffsetRatio?: number;
          note?: string;
        }>;
      };

      return {
        source: 'ai',
        bearing: this.normalizeBearing(parsed.bearing ?? 0),
        distanceRatio: this.clampNumber(
          Number(parsed.distanceRatio ?? 0.75),
          0.45,
          0.92,
        ),
        scenicCurve: this.clampNumber(Number(parsed.scenicCurve ?? 0), -1, 1),
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim()
            : `${behavior} pokemon chose a route style with AI guidance.`,
        waypoints: this.normalizeAiWaypoints(parsed.waypoints),
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
          waypoints: this.buildHeuristicWaypoints(
            Behavior.Water,
            0.75 * routeBias,
          ),
        };
      case Behavior.Tree:
        return {
          source: 'heuristic',
          bearing: this.normalizeBearing(25 + seed * 120 - 60),
          distanceRatio: this.clampNumber(0.58 + seed * 0.22, 0.4, 0.9),
          scenicCurve: this.clampNumber(-0.55 * routeBias, -1, 1),
          reason:
            'Tree pokemon prefers a wandering path that feels closer to parks and greener edges.',
          waypoints: this.buildHeuristicWaypoints(
            Behavior.Tree,
            -0.55 * routeBias,
          ),
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
          waypoints: this.buildHeuristicWaypoints(
            Behavior.City,
            0.18 * routeBias,
          ),
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
    plannedTrip: PlannedTrip,
  ) {
    const waypointPoints = this.buildWaypointPoints(
      origin,
      destination,
      behavior,
      plannedTrip,
    );
    const routePoints = await this.tryGenerateRouteWithWaypointHints(
      origin,
      destination,
      waypointPoints,
    );

    if (routePoints) {
      return routePoints;
    }

    return this.buildFallbackRoute(origin, destination, waypointPoints);
  }

  private async tryGenerateRouteWithWaypointHints(
    origin: GeoPoint,
    destination: GeoPoint,
    waypointPoints: GeoPoint[],
  ): Promise<GeoPoint[] | null> {
    try {
      const response = await fetch(
        `${this.openStreetMapBaseUrl}/route/v1/${this.openStreetMapProfile}/${origin.lng},${origin.lat};${[
          ...waypointPoints,
          destination,
        ]
          .map((point) => `${point.lng},${point.lat}`)
          .join(';')}?overview=full&geometries=geojson&steps=false`,
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        routes?: Array<{
          geometry?: {
            coordinates?: number[][];
          };
        }>;
      };
      const coordinates = payload.routes?.[0]?.geometry?.coordinates;

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
    waypointPoints: GeoPoint[],
  ) {
    const anchors = [origin, ...waypointPoints, destination];
    const path: GeoPoint[] = [origin];

    for (let index = 0; index < anchors.length - 1; index += 1) {
      const start = anchors[index];
      const end = anchors[index + 1];
      const segmentDistance = this.distanceBetweenMeters(start, end);
      const segmentSteps = Math.max(
        2,
        Math.min(6, Math.round(segmentDistance / 120) + 1),
      );

      for (let step = 1; step <= segmentSteps; step += 1) {
        path.push(this.interpolatePoint(start, end, step / segmentSteps));
      }
    }

    return path;
  }

  private buildWaypointPoints(
    origin: GeoPoint,
    destination: GeoPoint,
    behavior: Behavior,
    plannedTrip: PlannedTrip,
  ) {
    const waypointHints = plannedTrip.waypoints.length
      ? plannedTrip.waypoints
      : this.buildHeuristicWaypoints(behavior, plannedTrip.scenicCurve);
    const baseBearing = this.initialBearing(origin, destination);
    const perpendicularBearing = this.normalizeBearing(baseBearing + 90);
    const maxOffsetMeters = Math.max(
      20,
      Math.min(this.distanceBetweenMeters(origin, destination) * 0.22, 180),
    );

    return waypointHints
      .slice()
      .sort((left, right) => left.progress - right.progress)
      .map((waypoint) => {
        const anchorPoint = this.interpolatePoint(
          origin,
          destination,
          waypoint.progress,
        );
        const offsetMeters =
          this.clampNumber(waypoint.lateralOffsetRatio, -1, 1) *
          maxOffsetMeters;

        if (Math.abs(offsetMeters) < 2) {
          return anchorPoint;
        }

        return this.offsetPoint(
          anchorPoint,
          Math.abs(offsetMeters),
          offsetMeters >= 0
            ? perpendicularBearing
            : this.normalizeBearing(perpendicularBearing + 180),
        );
      });
  }

  private async tryGenerateRouteWithOpenStreetMap(
    origin: GeoPoint,
    requestedDistanceMeters: number,
    plannedTrip: PlannedTrip,
  ): Promise<RoutedPathPlan | null> {
    const candidateDestinations = this.buildOpenStreetMapDestinations(
      origin,
      requestedDistanceMeters,
      plannedTrip,
    );

    try {
      const routedCandidates = await Promise.all(
        candidateDestinations.map((destination) =>
          this.fetchOpenStreetMapRoute(origin, destination),
        ),
      );
      const validCandidates = routedCandidates.filter(
        (candidate): candidate is RoutedPathPlan => candidate !== null,
      );

      if (!validCandidates.length) {
        return null;
      }

      return validCandidates.sort(
        (left, right) =>
          Math.abs(left.distanceMeters - requestedDistanceMeters) -
          Math.abs(right.distanceMeters - requestedDistanceMeters),
      )[0];
    } catch {
      return null;
    }
  }

  private buildOpenStreetMapDestinations(
    origin: GeoPoint,
    requestedDistanceMeters: number,
    plannedTrip: PlannedTrip,
  ) {
    const candidateAdjustments = [
      { bearingOffset: 0, ratioOffset: 0 },
      { bearingOffset: 35, ratioOffset: 0 },
      { bearingOffset: -35, ratioOffset: 0 },
      { bearingOffset: 0, ratioOffset: 0.08 },
      { bearingOffset: 0, ratioOffset: -0.08 },
      { bearingOffset: 70, ratioOffset: -0.04 },
      { bearingOffset: -70, ratioOffset: -0.04 },
    ];

    return candidateAdjustments.map((adjustment) =>
      this.offsetPoint(
        origin,
        requestedDistanceMeters *
          this.clampNumber(
            plannedTrip.distanceRatio + adjustment.ratioOffset,
            0.4,
            0.92,
          ),
        this.normalizeBearing(plannedTrip.bearing + adjustment.bearingOffset),
      ),
    );
  }

  private async fetchOpenStreetMapRoute(
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<RoutedPathPlan | null> {
    try {
      const response = await fetch(
        `${this.openStreetMapBaseUrl}/route/v1/${this.openStreetMapProfile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`,
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        routes?: Array<{
          distance?: number;
          geometry?: {
            coordinates?: number[][];
          };
        }>;
      };
      const route = payload.routes?.[0];
      const coordinates = route?.geometry?.coordinates;
      const routeDistance = Number(route?.distance);

      if (
        !route ||
        !Number.isFinite(routeDistance) ||
        !coordinates ||
        coordinates.length < 2
      ) {
        return null;
      }

      const points = coordinates
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

      if (points.length < 2) {
        return null;
      }

      return {
        destination: points[points.length - 1],
        distanceMeters: routeDistance,
        points,
      };
    } catch {
      return null;
    }
  }

  private buildHeuristicWaypoints(
    behavior: Behavior,
    scenicCurve: number,
  ): PlannedWaypoint[] {
    const curveStrength = this.clampNumber(Math.abs(scenicCurve), 0.15, 1);
    const curveDirection = scenicCurve >= 0 ? 1 : -1;

    switch (behavior) {
      case Behavior.Water:
        return [
          {
            progress: 0.28,
            lateralOffsetRatio: 0.45 * curveStrength * curveDirection,
            note: 'ease into a curved outward drift',
          },
          {
            progress: 0.64,
            lateralOffsetRatio: 0.72 * curveStrength * curveDirection,
            note: 'keep the route flowing in the same direction',
          },
        ];
      case Behavior.Tree:
        return [
          {
            progress: 0.2,
            lateralOffsetRatio: -0.42 * curveStrength * curveDirection,
            note: 'start with a meandering detour',
          },
          {
            progress: 0.47,
            lateralOffsetRatio: 0.24 * curveStrength * curveDirection,
            note: 'cross back through a calmer midpoint',
          },
          {
            progress: 0.76,
            lateralOffsetRatio: -0.5 * curveStrength * curveDirection,
            note: 'finish with another soft wander',
          },
        ];
      case Behavior.City:
      default:
        return [
          {
            progress: 0.36,
            lateralOffsetRatio: 0.16 * curveStrength * curveDirection,
            note: 'small outward jog toward a nearby landmark',
          },
          {
            progress: 0.7,
            lateralOffsetRatio: -0.14 * curveStrength * curveDirection,
            note: 'tight correction back toward the destination',
          },
        ];
    }
  }

  private normalizeAiWaypoints(
    waypoints:
      | Array<{
          progress?: number;
          lateralOffsetRatio?: number;
          note?: string;
        }>
      | undefined,
  ): PlannedWaypoint[] {
    if (!Array.isArray(waypoints)) {
      return [];
    }

    return waypoints
      .filter(
        (waypoint) =>
          waypoint &&
          Number.isFinite(waypoint.progress) &&
          Number.isFinite(waypoint.lateralOffsetRatio),
      )
      .map((waypoint) => ({
        progress: this.clampNumber(Number(waypoint.progress), 0.12, 0.88),
        lateralOffsetRatio: this.clampNumber(
          Number(waypoint.lateralOffsetRatio),
          -1,
          1,
        ),
        note:
          typeof waypoint.note === 'string' && waypoint.note.trim()
            ? waypoint.note.trim()
            : 'ai waypoint',
      }))
      .sort((left, right) => left.progress - right.progress)
      .slice(0, 3);
  }

  private normalizeGeneratedPoints(
    points: GeoPoint[],
    origin: GeoPoint,
    destination: GeoPoint,
  ) {
    const sanitizedPoints = [origin, ...points, destination].filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180,
    );

    const sampledPoints = this.samplePoints(
      sanitizedPoints,
      this.maxPersistedPoints,
    );
    const deduplicatedPoints: GeoPoint[] = [];

    for (const point of sampledPoints) {
      const lastPoint = deduplicatedPoints.at(-1);

      if (!lastPoint || this.distanceBetweenMeters(lastPoint, point) > 3) {
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

  private interpolatePoint(
    origin: GeoPoint,
    destination: GeoPoint,
    progress: number,
  ) {
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
      Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDistance / 2) ** 2;

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

  private offsetPoint(
    origin: GeoPoint,
    distanceMeters: number,
    bearingDegrees: number,
  ) {
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
        Math.cos(angularDistance) - Math.sin(startLat) * Math.sin(targetLat),
      );

    return {
      lat: (targetLat * 180) / Math.PI,
      lng: (((targetLng * 180) / Math.PI + 540) % 360) - 180,
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
