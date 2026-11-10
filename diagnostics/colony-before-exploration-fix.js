/*
 * A local, continuously moving ant-colony simulation. No route is calculated in
 * advance: each ant chooses its next neighbouring cell, remembers its own walk,
 * lays short-lived exploration pheromone while searching, and reinforces a
 * food trail along the route it discovers while carrying food home.
 */
(function attachColony(global) {
  'use strict';

  const DIRECTIONS = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [-1, -1], [1, -1]
  ];
  const BASE_PHEROMONE = 0.055;
  const BASE_PHEROMONE_FLOAT = Math.fround(BASE_PHEROMONE);
  const MAX_PHEROMONE = 7;
  const ALPHA = 1.6;
  const BETA = 2.1;
  const EVAPORATION_PER_SECOND = 0.085;
  const EXPLORATION_EVAPORATION_PER_SECOND = 0.28;
  const EXPLORATION_DEPOSIT = 0.14;
  const EXPLORATION_MAX = 1.4;
  // Searchers gradually fan out from the nest; this uses no food coordinates.
  const EXPLORATION_RADIUS_BIAS = 0.35;
  const EXPLORATION_PERSISTENCE = 1.3;
  const EXPLORATION_REPULSION = 4.6;
  const EDGE_ESCAPE_BAND = 30;
  const EDGE_ESCAPE_BIAS = 1.5;
  const SEARCH_MIN_DIAGONAL_STEPS = 1;
  const SEARCH_EXTRA_DIAGONAL_STEPS = 4;
  const SEARCH_AREA_STEPS = 0.01;
  const FOOD_SENSE_RADIUS = 100;
  const CUT_MIN_SECONDS = 0.75;
  const CUT_VARIATION_SECONDS = 0.45;
  const SNIFF_MIN_SECONDS = 0.3;
  const SNIFF_VARIATION_SECONDS = 0.3;
  const FOOD_SENSE_SECONDS = 0.32;
  const NEARBY_ALERT_RADIUS = 160;
  const NEARBY_ALERT_LIMIT = 6;
  const SURVEY_SECONDS = 0.42;
  const SURVEY_ANTS_PER_SOURCE = 2;
  const RECOVERY_SECONDS = 0.3;
  const CARRY_SPEED_SCALE = 0.78;
  const ENTRY_SECONDS = 0.48;
  const FILE_MIN_SIZE_BYTES = 2;
  const FILE_CHUNK_MIN_BYTES = 512;
  const FILE_CHUNK_TARGET_BYTES = 1024;
  const FILE_MAX_CHUNKS = 512;

  function createColony(options = {}) {
    let width = Math.max(1, Number(options.width) || 800);
    let height = Math.max(1, Number(options.height) || 600);
    const gridSize = Math.max(5, Number(options.gridSize) || 14);
    let cols = Math.max(1, Math.ceil(width / gridSize));
    let rows = Math.max(1, Math.ceil(height / gridSize));
    let cellCount = cols * rows;
    const count = Math.max(1, Math.min(240, Math.round(Number(options.count) || 36)));
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const nest = point(options.nest || { x: 42, y: 48 });
    let food = options.food ? point(options.food) : null;
    let obstacles = Array.isArray(options.obstacles) ? options.obstacles.slice() : [];
    let blocked = new Uint8Array(cellCount);
    let pheromone = new Float32Array(cellCount);
    let activePheromone = [];
    let activePheromoneFlags = new Uint8Array(cellCount);
    let sourceRoutes = new Map();
    let explorationPheromone = new Float32Array(cellCount);
    let activeExploration = [];
    let activeExplorationFlags = new Uint8Array(cellCount);
    let neighbourIds = new Int32Array(cellCount * DIRECTIONS.length);
    let neighbourCounts = new Uint8Array(cellCount);
    let nestDistances = new Float32Array(cellCount);
    let edgeClearances = new Float32Array(cellCount);
    let reachable = new Uint8Array(cellCount);
    let ants = [];
    let startId = 0;
    let goalId = -1;
    let spawnPoint = nest;
    let blockedNest = false;
    let blockedFood = false;
    let bestPath = null;
    let bestLength = Infinity;
    let bestPathSourceId = null;
    let iterations = 0;
    let discoveries = 0;
    let completedTrips = 0;
    let elapsed = 0;
    let fileFood = null;
    let fileFoods = new Map();
    let multiFileMode = false;
    let foodSources = [];
    let fileTaskSequence = 0;
    let announcedSources = new Set();
    let surveyedSources = new Map();

    function sourceMarker(source) {
      return JSON.stringify([source.id, source.task?.token || 0,
        source.task?.position || source.position]);
    }

    function sourceIdentity(source) {
      return JSON.stringify([source.id, source.task?.token || 0]);
    }

    function point(value) {
      return {
        x: Math.max(0.1, Math.min(width - 0.1, Number(value.x) || 0)),
        y: Math.max(0.1, Math.min(height - 0.1, Number(value.y) || 0))
      };
    }

    function cellAt(value) {
      return Math.min(rows - 1, Math.floor(value.y / gridSize)) * cols +
        Math.min(cols - 1, Math.floor(value.x / gridSize));
    }

    function center(id) {
      return {
        x: Math.min(width - 0.1, (id % cols + 0.5) * gridSize),
        y: Math.min(height - 0.1, (Math.floor(id / cols) + 0.5) * gridSize)
      };
    }

    function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    function buildEdgeClearances() {
      edgeClearances = new Float32Array(cellCount);
      for (let id = 0; id < cellCount; id += 1) {
        const value = center(id);
        edgeClearances[id] = Math.min(value.x, width - value.x,
          value.y, height - value.y);
      }
    }

    function rectangle(item) {
      const rect = item.bounds || item;
      const x = Number(rect.x ?? rect.left);
      const y = Number(rect.y ?? rect.top);
      const w = Number(rect.w ?? rect.width ?? (Number(rect.right) - x));
      const h = Number(rect.h ?? rect.height ?? (Number(rect.bottom) - y));
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
      return { x, y, w, h };
    }

    function buildTerrain() {
      blocked = new Uint8Array(cellCount);
      // Normal icons occupy cells by their centres; thin barriers still cover
      // every touched cell so they cannot disappear between grid centres.
      const clearance = 2.6;
      for (const item of obstacles) {
        const rect = rectangle(item);
        if (!rect) continue;
        const left = rect.x - clearance;
        const right = rect.x + rect.w + clearance;
        const top = rect.y - clearance;
        const bottom = rect.y + rect.h + clearance;
        const thinX = right - left < gridSize;
        const thinY = bottom - top < gridSize;
        const minX = Math.max(0, Math.floor(left / gridSize));
        const maxX = Math.min(cols - 1, Math.floor(right / gridSize));
        const minY = Math.max(0, Math.floor(top / gridSize));
        const maxY = Math.min(rows - 1, Math.floor(bottom / gridSize));
        for (let y = minY; y <= maxY; y += 1) {
          const cy = (y + 0.5) * gridSize;
          if (!thinY && (cy < top || cy > bottom)) continue;
          for (let x = minX; x <= maxX; x += 1) {
            const cx = (x + 0.5) * gridSize;
            if (thinX || (cx >= left && cx <= right)) blocked[y * cols + x] = 1;
          }
        }
      }
      const requestedStart = cellAt(nest);
      blockedNest = Boolean(blocked[requestedStart]);
      startId = requestedStart;
      if (blockedNest) {
        let nearest = Infinity;
        startId = -1;
        for (let id = 0; id < cellCount; id += 1) {
          if (blocked[id]) continue;
          const d = distance(center(id), nest);
          if (d < nearest) { nearest = d; startId = id; }
        }
      }
      spawnPoint = blockedNest && startId >= 0 ? center(startId) : { ...nest };
      nestDistances = new Float32Array(cellCount);
      for (let id = 0; id < cellCount; id += 1) {
        nestDistances[id] = distance(center(id), spawnPoint);
      }
      goalId = food ? cellAt(food) : -1;
      blockedFood = goalId >= 0 && Boolean(blocked[goalId]);
      neighbourIds = new Int32Array(cellCount * DIRECTIONS.length);
      neighbourCounts = new Uint8Array(cellCount);
      for (let id = 0; id < cellCount; id += 1) {
        if (blocked[id]) continue;
        const x = id % cols;
        const y = Math.floor(id / cols);
        for (const [dx, dy] of DIRECTIONS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (blocked[next]) continue;
          // A diagonal must have clearance on both adjoining orthogonal cells.
          if (dx && dy && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          neighbourIds[id * DIRECTIONS.length + neighbourCounts[id]++] = next;
        }
      }
      reachable = new Uint8Array(cellCount);
      if (startId >= 0) {
        const queue = new Int32Array(cellCount);
        let head = 0;
        let tail = 1;
        queue[0] = startId;
        reachable[startId] = 1;
        while (head < tail) {
          const current = queue[head++];
          for (let offset = 0; offset < neighbourCounts[current]; offset += 1) {
            const next = neighbourIds[current * DIRECTIONS.length + offset];
            if (reachable[next]) continue;
            reachable[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      rebuildFoodSources();
    }

    function rebuildFoodSources() {
      foodSources = [];
      if (food) foodSources.push({
        id: null, position: food, task: multiFileMode ? null : fileFood,
        goalId, blockedFood
      });
      if (multiFileMode) {
        for (const task of fileFoods.values()) {
          task.goalId = task.position ? cellAt(task.position) : -1;
          task.blockedFood = task.goalId >= 0 && Boolean(blocked[task.goalId]);
          if (!task.position) continue;
          for (const accessPoint of task.accessPoints) {
            const accessGoalId = cellAt(accessPoint);
            foodSources.push({
              id: task.id, position: accessPoint, task,
              goalId: accessGoalId, blockedFood: Boolean(blocked[accessGoalId])
            });
          }
        }
      }
      const activeMarkers = new Set(foodSources.map(sourceMarker));
      const activeIdentities = new Set(foodSources.map(sourceIdentity));
      for (const marker of announcedSources) {
        if (!activeIdentities.has(marker)) announcedSources.delete(marker);
      }
      for (const marker of surveyedSources.keys()) {
        if (!activeMarkers.has(marker)) surveyedSources.delete(marker);
      }
    }

    function sourceAvailable(source) {
      return source && !source.blockedFood && reachable[source.goalId] &&
        (!source.task || source.task.pickedChunks + source.task.reservedChunks < source.task.chunkCount);
    }

    function currentSource(id, token, position) {
      return foodSources.find((source) => source.id === id &&
        (source.task?.token || 0) === token && samePoint(source.position, position));
    }

    function taskForAction(ant) {
      return ant.cutSourceId === null ? (multiFileMode ? null : fileFood) : fileFoods.get(ant.cutSourceId);
    }

    function canReach(value) {
      if (!value || startId < 0) return false;
      const candidate = point(value);
      return Boolean(reachable[cellAt(candidate)]);
    }

    function newTrailIndex() {
      // Zero means absent; a cell on the current trail stores its index plus one.
      return cellCount <= 65535 ? new Uint16Array(cellCount) : new Uint32Array(cellCount);
    }

    function resetTrailPoints(ant, start) {
      ant.pointCoords = new Float64Array(16);
      ant.pointCoords[0] = start.x;
      ant.pointCoords[1] = start.y;
      ant.pointCount = 1;
    }

    function trailPoint(ant, index) {
      return { x: ant.pointCoords[index * 2], y: ant.pointCoords[index * 2 + 1] };
    }

    function appendTrailPoint(ant, value) {
      const offset = ant.pointCount * 2;
      if (offset === ant.pointCoords.length) {
        const grown = new Float64Array(ant.pointCoords.length * 2);
        grown.set(ant.pointCoords);
        ant.pointCoords = grown;
      }
      ant.pointCoords[offset] = value.x;
      ant.pointCoords[offset + 1] = value.y;
      ant.pointCount += 1;
    }

    function clearAction(ant) {
      const task = ant.action === 'cutting' || ant.action === 'survey' ? taskForAction(ant) : null;
      if (task && task.token === ant.cutTaskToken) {
        task.reservedChunks = Math.max(0, task.reservedChunks - 1);
      }
      ant.action = null;
      ant.actionTime = 0;
      ant.actionDuration = 0;
      ant.cutFood = null;
      ant.cutSourceId = null;
      ant.cutTaskToken = 0;
      ant.actionSourceMarker = null;
    }

    function beginAction(ant, action, duration) {
      clearAction(ant);
      ant.action = action;
      ant.actionTime = 0;
      ant.actionDuration = duration;
    }

    function searchBudget(ant) {
      ant.excursions = (ant.excursions || 0) + 1;
      const phase = (ant.id * 0.61803398875 + ant.excursions * 0.38196601125) % 1;
      return Math.max(30, Math.round(Math.hypot(width, height) / gridSize *
        (SEARCH_MIN_DIAGONAL_STEPS + phase * SEARCH_EXTRA_DIAGONAL_STEPS) +
        cellCount * SEARCH_AREA_STEPS));
    }

    function startSearch(ant, delay = 0) {
      clearAction(ant);
      ant.x = spawnPoint.x;
      ant.y = spawnPoint.y;
      ant.cell = startId;
      ant.mode = 'search';
      ant.move = null;
      ant.visited = new Uint8Array(cellCount);
      if (startId >= 0) ant.visited[startId] = 1;
      ant.trail = [startId];
      resetTrailPoints(ant, spawnPoint);
      ant.trailIndex = newTrailIndex();
      if (startId >= 0) ant.trailIndex[startId] = 1;
      ant.steps = 0;
      ant.searchBudget = searchBudget(ant);
      ant.delay = delay;
      ant.sniffCooldown = 3 + random() * 4;
      ant.recovering = false;
      ant.returnPath = null;
      ant.returnIndex = -1;
      ant.deposit = 0;
      ant.routeSourceId = null;
      ant.routeSourceToken = 0;
      ant.routeSourcePosition = null;
      ant.payloadKind = null;
      ant.payloadBytes = 0;
      ant.payloadTaskId = null;
      ant.payloadTaskToken = 0;
      ant.entryTime = 0;
    }

    function reset() {
      pheromone = new Float32Array(cellCount).fill(BASE_PHEROMONE);
      activePheromone = [];
      activePheromoneFlags = new Uint8Array(cellCount);
      sourceRoutes = new Map();
      explorationPheromone = new Float32Array(cellCount);
      activeExploration = [];
      activeExplorationFlags = new Uint8Array(cellCount);
      bestPath = null;
      bestLength = Infinity;
      bestPathSourceId = null;
      iterations = 0;
      discoveries = 0;
      completedTrips = 0;
      elapsed = 0;
      announcedSources = new Set();
      surveyedSources = new Map();
      if (fileFood) {
        fileFood.reservedChunks = 0;
        fileFood.pickedChunks = 0;
        fileFood.deliveredChunks = 0;
        fileFood.pickedBytes = 0;
        fileFood.deliveredBytes = 0;
        fileFood.token = ++fileTaskSequence;
      }
      for (const task of fileFoods.values()) {
        task.reservedChunks = 0;
        task.pickedChunks = 0;
        task.deliveredChunks = 0;
        task.pickedBytes = 0;
        task.deliveredBytes = 0;
        task.token = ++fileTaskSequence;
      }
      ants = Array.from({ length: count }, (_, id) => {
        const ant = { id, angle: random() * Math.PI * 2, speed: 62 + random() * 28, payloadKind: null, payloadBytes: 0, payloadTaskId: null, payloadTaskToken: 0 };
        startSearch(ant, id * 0.065);
        return ant;
      });
    }

    function createFileTask(value) {
      const size = Number(value?.totalBytes);
      const totalBytes = Number.isFinite(size) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(size))) : 0;
      const chunkCount = totalBytes < FILE_MIN_SIZE_BYTES ? 0 : totalBytes < 1024
        ? 2 : Math.max(2, Math.min(FILE_MAX_CHUNKS, Math.round(totalBytes / FILE_CHUNK_TARGET_BYTES)));
      return {
        id: value?.id == null ? '' : String(value.id),
        totalBytes,
        chunkCount,
        reservedChunks: 0,
        pickedChunks: 0,
        deliveredChunks: 0,
        pickedBytes: 0,
        deliveredBytes: 0,
        position: value?.position ? point(value.position) : null,
        accessPoints: [],
        goalId: -1,
        blockedFood: false,
        token: ++fileTaskSequence
      };
    }

    function nextFileChunkBytes(task) {
      const remaining = task.totalBytes - task.pickedBytes;
      const slots = task.chunkCount - task.pickedChunks;
      if (remaining <= 0 || slots <= 0) return 0;
      if (slots === 1) return remaining;

      if (task.totalBytes < 1024) {
        const minimum = Math.max(1, Math.ceil(task.totalBytes * 0.25));
        const maximum = Math.min(task.totalBytes - 1, Math.floor(task.totalBytes * 0.75));
        const roll = Number(random());
        const fraction = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999999, roll)) : 0.5;
        return minimum + Math.floor(fraction * (maximum - minimum + 1));
      }

      const average = task.totalBytes / task.chunkCount;
      const minimum = Math.max(FILE_CHUNK_MIN_BYTES, Math.floor(average / 2));
      const maximum = Math.min(task.totalBytes - 1, Math.ceil(average * 1.5));
      const reserve = BigInt(slots - 1);
      const remainingExact = BigInt(remaining);
      const minimumExact = BigInt(minimum);
      const maximumExact = BigInt(maximum);
      const lowerBound = remainingExact - reserve * maximumExact;
      const upperBound = remainingExact - reserve * minimumExact;
      const low = Number(lowerBound > minimumExact ? lowerBound : minimumExact);
      const high = Number(upperBound < maximumExact ? upperBound : maximumExact);
      const roll = Number(random());
      const fraction = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999999, roll)) : 0.5;
      return low + Math.floor(fraction * (high - low + 1));
    }

    function pickFoodPayload(ant, task) {
      if (task) {
        const bytes = nextFileChunkBytes(task);
        if (!bytes) return false;
        task.pickedChunks += 1;
        task.pickedBytes += bytes;
        ant.payloadKind = 'file';
        ant.payloadBytes = bytes;
        ant.payloadTaskId = task.id;
        ant.payloadTaskToken = task.token;
        return true;
      }
      ant.payloadKind = 'food';
      ant.payloadBytes = 0;
      ant.payloadTaskId = null;
      ant.payloadTaskToken = 0;
      return true;
    }

    function completePayload(ant) {
      const task = multiFileMode ? fileFoods.get(ant.payloadTaskId) : fileFood;
      if (ant.payloadKind === 'file' && task && ant.payloadTaskToken === task.token) {
        task.deliveredChunks = Math.min(task.pickedChunks, task.deliveredChunks + 1);
        task.deliveredBytes = Math.min(task.pickedBytes, task.deliveredBytes + ant.payloadBytes);
      }
    }

    function setFileFood(task) {
      for (const ant of ants) {
        if (ant.action === 'cutting' || ant.action === 'survey') clearAction(ant);
        if (ant.mode === 'search' && ant.move?.kind === 'food') ant.move = null;
      }
      multiFileMode = false;
      fileFoods.clear();
      fileFood = task ? createFileTask(task) : null;
      sourceRoutes.clear();
      refreshBestRoute();
      rebuildFoodSources();
    }

    function setFileFoods(values) {
      const next = new Map();
      const nextPositions = new Map();
      const nextAccessPoints = new Map();
      for (const value of Array.isArray(values) ? values : []) {
        if (value?.id == null) continue;
        const id = String(value.id);
        if (!id || next.has(id)) continue;
        const size = Number(value.totalBytes);
        const totalBytes = Number.isFinite(size)
          ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(size))) : 0;
        const previous = fileFoods.get(id);
        const task = previous?.totalBytes === totalBytes ? previous : createFileTask({ id, totalBytes });
        next.set(id, task);
        const position = value.position ? point(value.position) : null;
        nextPositions.set(id, position);
        nextAccessPoints.set(id, fileAccessPoints(value, position));
      }
      const hasPoint = (id, position) => nextAccessPoints.get(id)?.some((value) => samePoint(value, position));
      const abandonedAccessPoints = [];
      for (const [id, task] of fileFoods) {
        for (const accessPoint of task.accessPoints) {
          if (!hasPoint(id, accessPoint)) abandonedAccessPoints.push(accessPoint);
        }
      }
      const changedSources = new Set();
      const replacedSources = new Set();
      const movedFoodPoints = [];
      const interruptedCutters = new Set();
      for (const [id, task] of fileFoods) {
        if (task !== next.get(id)) replacedSources.add(id);
        if (replacedSources.has(id) ||
          !samePointList(task.accessPoints, nextAccessPoints.get(id))) {
          changedSources.add(id);
          if (task === next.get(id) && nextPositions.get(id)) {
            movedFoodPoints.push(...task.accessPoints, ...nextAccessPoints.get(id));
          }
        }
      }
      for (const ant of ants) {
        if (ant.action === 'cutting' || ant.action === 'survey') {
          if (ant.cutSourceId === null) {
            if (!multiFileMode || ant.cutTaskToken !== 0 || !samePoint(ant.cutFood, food)) {
              interruptedCutters.add(ant.id);
              clearAction(ant);
            }
          } else {
            const task = next.get(ant.cutSourceId);
            if (!task || task.token !== ant.cutTaskToken ||
              !hasPoint(ant.cutSourceId, ant.cutFood)) {
              interruptedCutters.add(ant.id);
              clearAction(ant);
            }
          }
        }
        if (ant.mode === 'search' && ant.move?.kind === 'food') {
          const task = next.get(ant.move.sourceId);
          if (ant.move.sourceId === null ? !multiFileMode :
            !task || task.token !== ant.move.sourceToken ||
            !hasPoint(ant.move.sourceId, ant.move)) ant.move = null;
        }
        if (ant.routeSourcePosition && ant.routeSourceId !== null &&
          !hasPoint(ant.routeSourceId, ant.routeSourcePosition)) ant.deposit = 0;
      }
      fileFood = null;
      fileFoods = next;
      multiFileMode = true;
      for (const [id, task] of fileFoods) {
        task.position = nextPositions.get(id);
        task.accessPoints = nextAccessPoints.get(id);
      }
      rebuildFoodSources();
      for (const id of changedSources) {
        const route = sourceRoutes.get(id);
        if (replacedSources.has(id)) sourceRoutes.delete(id);
        else if (route) {
          route.bestPath = null;
          route.bestLength = Infinity;
        }
      }
      if (changedSources.size) refreshBestRoute();
      fadeAbandonedFoodCells(abandonedAccessPoints);
      if (movedFoodPoints.length) {
        for (const ant of ants) {
          if (ant.mode !== 'search' || ant.action || interruptedCutters.has(ant.id) ||
            elapsed - (ant.lastReorientAt ?? -Infinity) < 1.2 ||
            !movedFoodPoints.some((position) => distance(ant, position) <= FOOD_SENSE_RADIUS)) continue;
          ant.move = null;
          beginAction(ant, 'reorient', SNIFF_MIN_SECONDS + random() * SNIFF_VARIATION_SECONDS);
          ant.lastReorientAt = elapsed;
        }
      }
    }

    function fadeAbandonedFoodCells(points) {
      const cells = new Set(points.filter(Boolean).map(cellAt));
      for (const id of cells) {
        if (foodSources.some((source) => source.goalId === id && sourceAvailable(source))) continue;
        pheromone[id] = BASE_PHEROMONE + (pheromone[id] - BASE_PHEROMONE) * 0.05;
      }
    }

    function fileAccessPoints(value, position) {
      if (!position) return [];
      const candidates = Array.isArray(value.accessPoints) ? value.accessPoints : [position];
      const points = [];
      const cells = new Set();
      for (const candidate of candidates) {
        if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
        const accessPoint = point(candidate);
        const cell = cellAt(accessPoint);
        if (cells.has(cell)) continue;
        points.push(accessPoint);
        cells.add(cell);
        if (points.length === 16) break;
      }
      return points;
    }

    function samePointList(left, right) {
      return Boolean(left && right && left.length === right.length &&
        left.every((value, index) => samePoint(value, right[index])));
    }

    function nearestOpenPoint(value) {
      const requested = point(value);
      const requestedCell = cellAt(requested);
      if (!blocked[requestedCell]) return requested;
      let nearest = Infinity;
      let candidate = null;
      for (let id = 0; id < cellCount; id += 1) {
        if (blocked[id]) continue;
        const position = center(id);
        const d = distance(position, requested);
        if (d < nearest) {
          nearest = d;
          candidate = position;
        }
      }
      return candidate || spawnPoint;
    }

    function startLocalSearch(ant, carrying) {
      clearAction(ant);
      const current = nearestOpenPoint(ant);
      const currentCell = cellAt(current);
      ant.x = current.x;
      ant.y = current.y;
      ant.cell = currentCell;
      ant.move = null;
      ant.mode = carrying ? 'homing' : 'search';
      ant.returnPath = null;
      ant.returnIndex = -1;
      ant.deposit = carrying ? Math.max(0.25, ant.deposit || 0) : 0;
      ant.routeSourceId = null;
      ant.routeSourceToken = 0;
      ant.routeSourcePosition = null;
      ant.visited = new Uint8Array(cellCount);
      ant.visited[currentCell] = 1;
      ant.trail = [currentCell];
      resetTrailPoints(ant, current);
      ant.trailIndex = newTrailIndex();
      ant.trailIndex[currentCell] = 1;
      ant.steps = 0;
      if (!carrying) ant.searchBudget = searchBudget(ant);
      ant.delay = 0;
      ant.recovering = false;
      ant.entryTime = 0;
    }

    function noticeFood(ant, source) {
      const marker = sourceMarker(source);
      if (ant.sensedSourceMarker === marker) return false;
      ant.sensedSourceMarker = marker;
      const identity = sourceIdentity(source);
      if (!announcedSources.has(identity)) {
        announcedSources.add(identity);
        const nearby = ants.filter((neighbour) =>
          neighbour !== ant && neighbour.mode === 'search' && !neighbour.action &&
          distance(neighbour, ant) <= NEARBY_ALERT_RADIUS);
        nearby.sort((left, right) => distance(left, ant) - distance(right, ant));
        for (const neighbour of nearby.slice(0, NEARBY_ALERT_LIMIT)) {
          beginAction(neighbour, 'alert', 0.2 + (neighbour.id % 5) * 0.065);
        }
      }
      if (elapsed - (ant.lastFoodSenseAt ?? -Infinity) < 1.2) return false;
      ant.lastFoodSenseAt = elapsed;
      beginAction(ant, 'sense', FOOD_SENSE_SECONDS + random() * 0.12);
      return true;
    }

    function linked(a, b) {
      if (a < 0 || b < 0 || a >= cellCount || b >= cellCount || blocked[a] || blocked[b]) return false;
      if (a === b) return true;
      for (let offset = 0; offset < neighbourCounts[a]; offset += 1) {
        if (neighbourIds[a * DIRECTIONS.length + offset] === b) return true;
      }
      return false;
    }

    function trailIsOpen(trail) {
      for (let index = 0; index < trail.length; index += 1) {
        if (blocked[trail[index]]) return false;
        if (index && !linked(trail[index - 1], trail[index])) return false;
      }
      return true;
    }

    function returnPathIsOpen(ant) {
      if (!Array.isArray(ant.returnPath)) return false;
      let previous = cellAt(ant);
      for (let index = ant.returnIndex; index >= 0; index -= 1) {
        const value = ant.returnPath[index];
        if (!value) return false;
        const next = cellAt(value);
        if (!linked(previous, next)) return false;
        previous = next;
      }
      return true;
    }

    function pointsPathIsOpen(path) {
      for (let index = 0; index < path.length; index += 1) {
        const current = cellAt(path[index]);
        if (blocked[current]) return false;
        if (index && !linked(cellAt(path[index - 1]), current)) return false;
      }
      return true;
    }

    function preserveAntsAfterTerrainChange(foodChanged, obstaclesChanged, nestChanged) {
      for (const ant of ants) {
        if (foodChanged && (ant.action === 'cutting' || ant.action === 'survey') && ant.cutSourceId === null) clearAction(ant);
        if (foodChanged && ant.mode === 'search' && ant.move?.kind === 'food' &&
          ant.move.sourceId === null) ant.move = null;
        if (nestChanged && (ant.mode === 'return' || ant.mode === 'retreat' || ant.mode === 'deposit')) {
          startLocalSearch(ant, Boolean(ant.payloadKind));
          continue;
        }
        if (!obstaclesChanged) continue;
        const current = cellAt(ant);
        const carrying = Boolean(ant.payloadKind);
        const pathOpen = ant.mode === 'return' || ant.mode === 'retreat'
          ? returnPathIsOpen(ant) : trailIsOpen(ant.trail);
        const movementOpen = !ant.move || linked(current, cellAt(ant.move));
        const baseOpen = carrying || !blocked[ant.cell];
        if (!blocked[current] && baseOpen && pathOpen && movementOpen) continue;
        const wasCutting = ant.action === 'cutting' || ant.action === 'survey';
        // Only an ant whose own route was cut changes state. A food carrier
        // explores homeward instead of following a now-blocked remembered walk.
        startLocalSearch(ant, carrying);
        if (!carrying && !wasCutting) {
          beginAction(ant, 'sniff', SNIFF_MIN_SECONDS + random() * SNIFF_VARIATION_SECONDS);
          ant.sniffCooldown = 4 + random() * 5;
        }
      }
    }

    function samePoint(a, b) {
      return a === b || Boolean(a && b && a.x === b.x && a.y === b.y);
    }

    function sameObstacles(a, b) {
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        const left = rectangle(a[index]);
        const right = rectangle(b[index]);
        if (!left || !right || left.x !== right.x || left.y !== right.y || left.w !== right.w || left.h !== right.h) {
          return false;
        }
      }
      return true;
    }

    function setTerrain(changes = {}) {
      const nextNest = Object.prototype.hasOwnProperty.call(changes, 'nest')
        ? point(changes.nest || nest) : nest;
      const nextFood = Object.prototype.hasOwnProperty.call(changes, 'food')
        ? (changes.food ? point(changes.food) : null) : food;
      const nextObstacles = Object.prototype.hasOwnProperty.call(changes, 'obstacles')
        ? (Array.isArray(changes.obstacles) ? changes.obstacles.slice() : []) : obstacles;
      const nestChanged = !samePoint(nest, nextNest);
      const foodChanged = !samePoint(food, nextFood);
      const oldFood = food;
      const interruptedCutters = foodChanged ? new Set(ants.filter((ant) =>
        (ant.action === 'cutting' || ant.action === 'survey') && ant.cutSourceId === null)
        .map((ant) => ant.id)) : null;
      const obstaclesChanged = !sameObstacles(obstacles, nextObstacles);
      if (!nestChanged && !foodChanged && !obstaclesChanged) return;
      nest.x = nextNest.x;
      nest.y = nextNest.y;
      food = nextFood;
      obstacles = nextObstacles;
      buildTerrain();
      if (foodChanged && oldFood) {
        fadeAbandonedFoodCells([oldFood]);
      }
      if (foodChanged) {
        sourceRoutes.delete(null);
        for (const ant of ants) {
          if (ant.routeSourcePosition && ant.routeSourceId === null) ant.deposit = 0;
        }
      }
      if (nestChanged) {
        sourceRoutes.clear();
      }
      if (obstaclesChanged) {
        let write = 0;
        for (const id of activePheromone) {
          if (blocked[id]) {
            pheromone[id] = BASE_PHEROMONE;
            activePheromoneFlags[id] = 0;
          } else {
            activePheromone[write++] = id;
          }
        }
        activePheromone.length = write;
        write = 0;
        for (const id of activeExploration) {
          if (blocked[id]) {
            explorationPheromone[id] = 0;
            activeExplorationFlags[id] = 0;
          } else {
            activeExploration[write++] = id;
          }
        }
        activeExploration.length = write;
      }
      if (obstaclesChanged) {
        for (const route of sourceRoutes.values()) {
          if (route.bestPath && !pointsPathIsOpen(route.bestPath)) {
            route.bestPath = null;
            route.bestLength = Infinity;
          }
        }
      }
      refreshBestRoute();
      if (ants.length) preserveAntsAfterTerrainChange(foodChanged, obstaclesChanged, nestChanged);
      if (foodChanged && oldFood && food) {
        for (const ant of ants) {
          if (ant.mode !== 'search' || ant.action || interruptedCutters.has(ant.id) ||
            elapsed - (ant.lastReorientAt ?? -Infinity) < 1.2 ||
            Math.min(distance(ant, oldFood), distance(ant, food)) > FOOD_SENSE_RADIUS) continue;
          ant.move = null;
          beginAction(ant, 'reorient', SNIFF_MIN_SECONDS + random() * SNIFF_VARIATION_SECONDS);
          ant.lastReorientAt = elapsed;
        }
      }
    }

    function resize(nextWidth, nextHeight, changes = {}) {
      const resizedWidth = Math.max(1, Number(nextWidth) || width);
      const resizedHeight = Math.max(1, Number(nextHeight) || height);
      if (resizedWidth === width && resizedHeight === height) {
        setTerrain(changes);
        return;
      }

      const oldCols = cols;
      const oldRows = rows;
      const oldPheromone = pheromone;
      const oldActivePheromone = activePheromone;
      const oldExploration = explorationPheromone;
      const oldActiveExploration = activeExploration;
      const oldNest = { ...nest };
      const oldFood = food;
      width = resizedWidth;
      height = resizedHeight;
      cols = Math.max(1, Math.ceil(width / gridSize));
      rows = Math.max(1, Math.ceil(height / gridSize));
      cellCount = cols * rows;
      buildEdgeClearances();

      const requestedNest = Object.prototype.hasOwnProperty.call(changes, 'nest') ? changes.nest || nest : nest;
      const nextNest = point(requestedNest);
      nest.x = nextNest.x;
      nest.y = nextNest.y;
      const requestedFood = Object.prototype.hasOwnProperty.call(changes, 'food') ? changes.food : food;
      food = requestedFood ? point(requestedFood) : null;
      for (const task of fileFoods.values()) {
        if (task.position) task.position = point(task.position);
        task.accessPoints = task.accessPoints.map(point);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'obstacles')) {
        obstacles = Array.isArray(changes.obstacles) ? changes.obstacles.slice() : [];
      }
      const nestChanged = !samePoint(oldNest, nest);
      const foodChanged = !samePoint(oldFood, food);

      pheromone = new Float32Array(cellCount).fill(BASE_PHEROMONE);
      explorationPheromone = new Float32Array(cellCount);
      for (let y = 0; y < Math.min(oldRows, rows); y += 1) {
        for (let x = 0; x < Math.min(oldCols, cols); x += 1) {
          pheromone[y * cols + x] = oldPheromone[y * oldCols + x];
          explorationPheromone[y * cols + x] = oldExploration[y * oldCols + x];
        }
      }
      buildTerrain();
      activePheromone = [];
      activePheromoneFlags = new Uint8Array(cellCount);
      for (const oldId of oldActivePheromone) {
        const x = oldId % oldCols;
        const y = Math.floor(oldId / oldCols);
        if (x >= cols || y >= rows) continue;
        const id = y * cols + x;
        if (blocked[id]) {
          pheromone[id] = BASE_PHEROMONE;
        } else {
          activePheromone.push(id);
          activePheromoneFlags[id] = 1;
        }
      }
      activeExploration = [];
      activeExplorationFlags = new Uint8Array(cellCount);
      for (const oldId of oldActiveExploration) {
        const x = oldId % oldCols;
        const y = Math.floor(oldId / oldCols);
        if (x >= cols || y >= rows) continue;
        const id = y * cols + x;
        if (blocked[id]) {
          explorationPheromone[id] = 0;
        } else {
          activeExploration.push(id);
          activeExplorationFlags[id] = 1;
        }
      }

      function withinBounds(value) {
        return value && value.x >= 0 && value.y >= 0 && value.x < width && value.y < height;
      }

      function remapCell(id) {
        if (!Number.isInteger(id) || id < 0 || id >= oldCols * oldRows) return -1;
        const x = id % oldCols;
        const y = Math.floor(id / oldCols);
        return x < cols && y < rows ? y * cols + x : -1;
      }

      if (nestChanged) sourceRoutes.clear();
      else if (foodChanged) sourceRoutes.delete(null);
      for (const route of sourceRoutes.values()) {
        if (route.bestPath && (route.bestPath.some((value) => !withinBounds(value)) ||
          !pointsPathIsOpen(route.bestPath))) {
          route.bestPath = null;
          route.bestLength = Infinity;
        }
      }
      refreshBestRoute();

      for (const ant of ants) {
        const carrying = Boolean(ant.payloadKind);
        const remappedCell = remapCell(ant.cell);
        const remappedTrail = ant.trail.map(remapCell);
        let pointClipped = false;
        for (let index = 0; index < ant.pointCount; index += 1) {
          const offset = index * 2;
          if (ant.pointCoords[offset] < 0 || ant.pointCoords[offset + 1] < 0 ||
            ant.pointCoords[offset] >= width || ant.pointCoords[offset + 1] >= height) {
            pointClipped = true;
            break;
          }
        }
        const routeClipped = !withinBounds(ant) || remappedCell < 0 ||
          remappedTrail.includes(-1) || pointClipped ||
          ((ant.mode === 'return' || ant.mode === 'retreat') &&
            (nestChanged || ant.returnPath.some((value) => !withinBounds(value)))) ||
          (ant.mode === 'deposit' && nestChanged) ||
          (ant.move && (!withinBounds(ant.move) ||
            (ant.move.cell !== undefined && remapCell(ant.move.cell) < 0)));
        if (routeClipped) {
          startLocalSearch(ant, carrying);
          continue;
        }

        if (foodChanged && (ant.action === 'cutting' || ant.action === 'survey') && ant.cutSourceId === null) clearAction(ant);

        const oldVisited = ant.visited;
        ant.visited = new Uint8Array(cellCount);
        for (let oldId = 0; oldId < oldVisited.length; oldId += 1) {
          if (!oldVisited[oldId]) continue;
          const nextId = remapCell(oldId);
          if (nextId >= 0) ant.visited[nextId] = 1;
        }
        ant.cell = remappedCell;
        ant.trail = remappedTrail;
        ant.trailIndex = newTrailIndex();
        remappedTrail.forEach((id, index) => { ant.trailIndex[id] = index + 1; });
        if (ant.move?.cell !== undefined) ant.move.cell = remapCell(ant.move.cell);
        if (foodChanged && ant.mode === 'search' && ant.move?.kind === 'food' &&
          ant.move.sourceId === null) ant.move = null;

        const current = cellAt(ant);
        const routeOpen = ant.mode === 'return' || ant.mode === 'retreat'
          ? returnPathIsOpen(ant) : trailIsOpen(ant.trail);
        const movementOpen = !ant.move || linked(current, cellAt(ant.move));
        if (blocked[current] || blocked[ant.cell] || !routeOpen || !movementOpen) {
          startLocalSearch(ant, carrying);
        }
      }
    }

    function chooseNeighbour(ant, candidates, target) {
      const current = center(ant.cell);
      const hasGoal = Boolean(target);
      const currentClearance = ant.mode === 'search' && !hasGoal
        ? edgeClearances[ant.cell] : Infinity;
      const currentDistance = hasGoal ? distance(current, target) : 0;
      const currentNestDistance = nestDistances[ant.cell];
      const explore = random() < 0.075;
      const choices = candidates.map((id) => {
        const next = center(id);
        const segment = distance(current, next);
        // A local goal heuristic encourages useful exploration without looking
        // through obstacles or knowing which side of an obstacle has a route.
        const progress = hasGoal ? (currentDistance - distance(next, target)) / gridSize : 0;
        const radialProgress = (nestDistances[id] - currentNestDistance) / gridSize;
        const eta = hasGoal ? Math.exp(progress * 0.92)
          : Math.exp(radialProgress * EXPLORATION_RADIUS_BIAS);
        const direction = Math.atan2(next.y - ant.y, next.x - ant.x);
        const persistence = hasGoal ? 1 : Math.exp(EXPLORATION_PERSISTENCE * Math.cos(direction - ant.angle));
        const tau = explore ? BASE_PHEROMONE : pheromone[id];
        const novelty = ant.mode === 'search'
          ? Math.exp(-EXPLORATION_REPULSION * explorationPheromone[id]) : 1;
        const revisit = ant.mode === 'search' && ant.visited[id] ? 0.4 : 1;
        const edgeEscape = currentClearance < EDGE_ESCAPE_BAND
          ? Math.exp(EDGE_ESCAPE_BIAS *
            (edgeClearances[id] - currentClearance) / gridSize) : 1;
        return { id, weight: Math.pow(tau, ALPHA) * Math.pow(eta, BETA) *
          persistence * novelty * revisit * edgeEscape * gridSize / segment };
      });
      if (ant.mode === 'search' && !hasGoal && ant.sniffCooldown <= 0 && choices.length >= 3) {
        const marked = choices.some(({ id }) =>
          pheromone[id] > BASE_PHEROMONE + 0.08 || explorationPheromone[id] > 0.08);
        let strongest = 0;
        let second = 0;
        for (const choice of choices) {
          if (choice.weight > strongest) {
            second = strongest;
            strongest = choice.weight;
          } else if (choice.weight > second) {
            second = choice.weight;
          }
        }
        if (marked && second >= strongest * 0.85 && random() < 0.07) {
          beginAction(ant, 'sniff', SNIFF_MIN_SECONDS + random() * SNIFF_VARIATION_SECONDS);
          ant.sniffCooldown = 4 + random() * 5;
          return null;
        }
      }
      const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
      let pick = random() * total;
      for (const choice of choices) {
        pick -= choice.weight;
        if (pick <= 0) return choice.id;
      }
      return choices[choices.length - 1].id;
    }

    function depositAt(id, amount) {
      if (id < 0 || id >= cellCount || blocked[id] || amount <= 0) return;
      pheromone[id] = Math.min(MAX_PHEROMONE, pheromone[id] + amount);
      if (activePheromoneFlags[id] || pheromone[id] === BASE_PHEROMONE_FLOAT) return;
      let low = 0;
      let high = activePheromone.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (activePheromone[middle] < id) low = middle + 1;
        else high = middle;
      }
      activePheromone.splice(low, 0, id);
      activePheromoneFlags[id] = 1;
    }

    function depositExplorationAt(id, amount = EXPLORATION_DEPOSIT) {
      if (id < 0 || id >= cellCount || blocked[id]) return;
      explorationPheromone[id] = Math.min(EXPLORATION_MAX, explorationPheromone[id] + amount);
      if (!activeExplorationFlags[id]) {
        activeExploration.push(id);
        activeExplorationFlags[id] = 1;
      }
    }

    function foundFood(ant, source) {
      if (!sourceAvailable(source) || !pickFoodPayload(ant, source.task)) return false;
      discoveries += 1;
      iterations += 1;
      // Path integration estimates the food's distance from home without
      // prescribing the route; the carrier reinforces only cells it traverses.
      ant.deposit = Math.min(1.4, 460 / Math.max(gridSize, distance(source.position, spawnPoint)));
      depositAt(source.goalId, ant.deposit);
      startLocalSearch(ant, true);
      ant.routeSourceId = source.id;
      ant.routeSourceToken = source.task?.token || 0;
      ant.routeSourcePosition = { ...source.position };
      return true;
    }

    function recordCompletedRoute(ant) {
      if (!ant.routeSourcePosition ||
        !currentSource(ant.routeSourceId, ant.routeSourceToken, ant.routeSourcePosition)) return false;
      const path = Array.from({ length: ant.pointCount }, (_, index) => trailPoint(ant, index));
      if (distance(path[path.length - 1], spawnPoint) > 0.01) path.push({ ...spawnPoint });
      let length = 0;
      for (let index = 1; index < path.length; index += 1) {
        length += distance(path[index - 1], path[index]);
      }
      let route = sourceRoutes.get(ant.routeSourceId);
      if (!route) {
        route = { bestLength: Infinity, bestPath: null, successfulReturns: 0 };
        sourceRoutes.set(ant.routeSourceId, route);
      }
      route.successfulReturns += 1;
      if (length < route.bestLength) {
        route.bestLength = length;
        route.bestPath = path.reverse();
      }
      refreshBestRoute();
      return true;
    }

    function refreshBestRoute() {
      bestPath = null;
      bestLength = Infinity;
      bestPathSourceId = null;
      for (const [id, route] of sourceRoutes) {
        if (!route.bestPath || route.bestLength >= bestLength) continue;
        bestPath = route.bestPath;
        bestLength = route.bestLength;
        bestPathSourceId = id;
      }
    }

    function beginCutting(ant, source) {
      if (!sourceAvailable(source)) return false;
      beginAction(ant, 'cutting', CUT_MIN_SECONDS + random() * CUT_VARIATION_SECONDS);
      ant.cutFood = { ...source.position };
      ant.cutSourceId = source.id;
      ant.cutTaskToken = source.task?.token || 0;
      if (source.task) source.task.reservedChunks += 1;
      return true;
    }

    function beginSurveyOrCutting(ant, source) {
      if (!sourceAvailable(source)) return false;
      const marker = sourceMarker(source);
      const surveyed = surveyedSources.get(marker) || 0;
      if (surveyed >= SURVEY_ANTS_PER_SOURCE) return beginCutting(ant, source);
      surveyedSources.set(marker, surveyed + 1);
      beginAction(ant, 'survey', SURVEY_SECONDS + random() * 0.15);
      ant.cutFood = { ...source.position };
      ant.cutSourceId = source.id;
      ant.cutTaskToken = source.task?.token || 0;
      ant.actionSourceMarker = marker;
      if (source.task) source.task.reservedChunks += 1;
      return true;
    }

    function beginDeposit(ant) {
      if (recordCompletedRoute(ant) && ant.payloadKind && ant.trail.length > 1) {
        let routeLength = 0;
        for (let index = 1; index < ant.trail.length; index += 1) {
          routeLength += distance(center(ant.trail[index - 1]), center(ant.trail[index]));
        }
        const straight = distance(center(ant.trail[0]), spawnPoint);
        const quality = Math.max(0.1, Math.min(1, straight / Math.max(gridSize, routeLength)));
        for (const id of ant.trail) depositAt(id, ant.deposit * 0.5 * quality);
      }
      ant.mode = 'deposit';
      ant.move = null;
      ant.entryTime = 0;
    }

    function beginRetreat(ant) {
      if (ant.pointCount <= 1) {
        if (distance(ant, spawnPoint) < 0.5) startSearch(ant, 0.1 + random() * 0.3);
        else startLocalSearch(ant, false);
        return;
      }
      ant.mode = 'retreat';
      ant.move = null;
      ant.returnPath = Array.from({ length: ant.pointCount - 1 }, (_, index) =>
        trailPoint(ant, index));
      ant.returnIndex = ant.returnPath.length - 1;
      ant.recovering = false;
    }

    function planMove(ant) {
      if (ant.mode === 'return') {
        if (ant.returnIndex < 0) {
          beginDeposit(ant);
          return false;
        }
        ant.move = { ...ant.returnPath[ant.returnIndex], kind: 'return' };
        return true;
      }
      if (ant.mode === 'retreat') {
        if (foodSources.some((source) => sourceAvailable(source) &&
          distance(ant, source.position) <= FOOD_SENSE_RADIUS)) {
          startLocalSearch(ant, false);
          return false;
        }
        if (ant.returnIndex < 0) {
          if (distance(ant, spawnPoint) < 0.5) startSearch(ant, 0.1 + random() * 0.3);
          else startLocalSearch(ant, false);
          return false;
        }
        ant.move = { ...ant.returnPath[ant.returnIndex], kind: 'retreat' };
        return true;
      }
      if (startId < 0 || ant.cell < 0) return false;
      if (ant.mode === 'homing' && ant.cell === startId) {
        if (distance(ant, spawnPoint) > 0.5) {
          ant.move = { ...spawnPoint, kind: 'nest' };
          return true;
        }
        beginDeposit(ant);
        return false;
      }
      let sensedSource = null;
      let nearestFood = FOOD_SENSE_RADIUS;
      if (ant.mode === 'search') {
        for (const source of foodSources) {
          if (!sourceAvailable(source)) continue;
          const separation = distance(ant, source.position);
          if (separation > nearestFood) continue;
          nearestFood = separation;
          sensedSource = source;
        }
        if (sensedSource && ant.cell === sensedSource.goalId) {
          if (noticeFood(ant, sensedSource)) return false;
          ant.move = { ...sensedSource.position, kind: 'food',
            sourceId: sensedSource.id, sourceToken: sensedSource.task?.token || 0 };
          return true;
        }
        if (sensedSource) {
          if (noticeFood(ant, sensedSource)) return false;
          for (let offset = 0; offset < neighbourCounts[ant.cell]; offset += 1) {
            if (neighbourIds[ant.cell * DIRECTIONS.length + offset] !== sensedSource.goalId) continue;
            ant.move = { ...center(sensedSource.goalId), cell: sensedSource.goalId, kind: 'search' };
            return true;
          }
        }
      }
      if (ant.mode === 'search' && !sensedSource && ant.steps >= ant.searchBudget) {
        beginRetreat(ant);
        return false;
      }
      const goal = ant.mode === 'homing' ? spawnPoint : sensedSource?.position || null;
      const fresh = [];
      const currentClearance = ant.mode === 'search' && !sensedSource
        ? edgeClearances[ant.cell] : Infinity;
      for (let offset = 0; offset < neighbourCounts[ant.cell]; offset += 1) {
        const id = neighbourIds[ant.cell * DIRECTIONS.length + offset];
        if (!ant.visited[id] || (ant.mode === 'search' && sensedSource) ||
          (currentClearance < EDGE_ESCAPE_BAND &&
            edgeClearances[id] > currentClearance)) fresh.push(id);
      }
      let next;
      if (fresh.length) {
        ant.recovering = false;
        next = chooseNeighbour(ant, fresh, goal);
        if (next === null) return false;
      } else if (ant.trail.length > 1) {
        // Retrace a dead end, then try a different unvisited branch. Keeping the
        // visited set prevents getting stuck bouncing between two dead cells.
        if (!ant.recovering) {
          ant.recovering = true;
          beginAction(ant, 'recover', RECOVERY_SECONDS + random() * 0.15);
          return false;
        }
        next = ant.trail[ant.trail.length - 2];
      } else {
        if (ant.mode === 'homing') {
          ant.visited.fill(0);
          ant.visited[ant.cell] = 1;
          beginAction(ant, 'recover', RECOVERY_SECONDS + random() * 0.15);
          return false;
        }
        iterations += 1;
        if (distance(ant, spawnPoint) < 0.5) startSearch(ant, 0.1 + random() * 0.3);
        else startLocalSearch(ant, false);
        return false;
      }
      const trailPosition = ant.trailIndex[next];
      const existing = trailPosition ? trailPosition - 1 : undefined;
      const target = existing === undefined ? center(next) : trailPoint(ant, existing);
      ant.move = { ...target, cell: next, kind: ant.mode };
      return true;
    }

    function arrive(ant, move) {
      ant.move = null;
      if (move.kind === 'food') {
        beginSurveyOrCutting(ant, currentSource(move.sourceId, move.sourceToken, move));
        return;
      }
      if (move.kind === 'return') {
        depositAt(cellAt(move), ant.deposit);
        ant.returnIndex -= 1;
        return;
      }
      if (move.kind === 'retreat') {
        ant.cell = cellAt(move);
        depositExplorationAt(ant.cell, EXPLORATION_DEPOSIT * 2);
        ant.returnIndex -= 1;
        return;
      }
      if (move.kind === 'nest') {
        beginDeposit(ant);
        return;
      }
      ant.cell = move.cell;
      ant.visited[move.cell] = 1;
      if (move.kind === 'homing' && ant.routeSourcePosition) {
        depositAt(move.cell, ant.deposit * 0.45);
      }
      else if (move.kind === 'search') depositExplorationAt(move.cell);
      ant.steps += 1;
      const trailPosition = ant.trailIndex[move.cell];
      const existing = trailPosition ? trailPosition - 1 : undefined;
      if (existing !== undefined) {
        for (let i = existing + 1; i < ant.trail.length; i += 1) ant.trailIndex[ant.trail[i]] = 0;
        ant.trail.length = existing + 1;
        ant.pointCount = existing + 1;
      } else {
        ant.trailIndex[move.cell] = ant.trail.length + 1;
        ant.trail.push(move.cell);
        appendTrailPoint(ant, move);
      }
    }

    function step(deltaSeconds = 1 / 60) {
      const dt = Math.max(0, Math.min(0.1, Number(deltaSeconds) || 0));
      if (!dt) return;
      elapsed += dt;
      const retention = Math.exp(-EVAPORATION_PER_SECOND * dt);
      let write = 0;
      for (const id of activePheromone) {
        pheromone[id] = BASE_PHEROMONE + (pheromone[id] - BASE_PHEROMONE) * retention;
        if (pheromone[id] === BASE_PHEROMONE_FLOAT) {
          activePheromoneFlags[id] = 0;
        } else {
          activePheromone[write++] = id;
        }
      }
      activePheromone.length = write;
      const explorationRetention = Math.exp(-EXPLORATION_EVAPORATION_PER_SECOND * dt);
      write = 0;
      for (const id of activeExploration) {
        explorationPheromone[id] *= explorationRetention;
        if (explorationPheromone[id] < 0.002) {
          explorationPheromone[id] = 0;
          activeExplorationFlags[id] = 0;
        } else {
          activeExploration[write++] = id;
        }
      }
      activeExploration.length = write;
      for (const ant of ants) {
        if (ant.sniffCooldown > 0) ant.sniffCooldown = Math.max(0, ant.sniffCooldown - dt);
        if (ant.action) {
          ant.actionTime = Math.min(ant.actionDuration, ant.actionTime + dt);
          if (ant.actionTime < ant.actionDuration) continue;
          const action = ant.action;
          const cutFood = ant.cutFood;
          const cutSourceId = ant.cutSourceId;
          const cutTaskToken = ant.cutTaskToken;
          clearAction(ant);
          if (action === 'cutting') {
            foundFood(ant, currentSource(cutSourceId, cutTaskToken, cutFood));
          } else if (action === 'survey') {
            beginCutting(ant, currentSource(cutSourceId, cutTaskToken, cutFood));
          }
          continue;
        }
        if (ant.mode === 'deposit') {
          ant.entryTime += dt;
          if (ant.entryTime >= ENTRY_SECONDS) {
            completedTrips += 1;
            completePayload(ant);
            startSearch(ant, 0.12 + random() * 0.35);
          }
          continue;
        }
        if (ant.delay > 0) { ant.delay -= dt; continue; }
        let remaining = ant.speed * (ant.mode === 'return' || ant.mode === 'homing' ? CARRY_SPEED_SCALE : 1) * dt;
        for (let transitions = 0; remaining > 0 && transitions < 16; transitions += 1) {
          if (!ant.move && !planMove(ant)) break;
          const move = ant.move;
          const dx = move.x - ant.x;
          const dy = move.y - ant.y;
          const length = Math.hypot(dx, dy);
          if (length > 0.001) ant.angle = Math.atan2(dy, dx);
          if (length <= remaining) {
            ant.x = move.x;
            ant.y = move.y;
            remaining -= length;
            arrive(ant, move);
            if (ant.action) break;
          } else {
            ant.x += dx / length * remaining;
            ant.y += dy / length * remaining;
            remaining = 0;
          }
        }
      }
    }

    function fileTaskSnapshot(task) {
      const route = sourceRoutes.get(task.id);
      return {
        id: task.id,
        totalBytes: task.totalBytes,
        chunkCount: task.chunkCount,
        pickedBytes: task.pickedBytes,
        deliveredBytes: task.deliveredBytes,
        pickedChunks: task.pickedChunks,
        deliveredChunks: task.deliveredChunks,
        bestLength: route?.bestLength ?? Infinity,
        successfulReturns: route?.successfulReturns || 0
      };
    }

    function snapshot(options = {}) {
      const traces = [];
      if (options.includePheromone !== false) {
        for (const id of activePheromone) {
          const strength = Math.min(1, (pheromone[id] - BASE_PHEROMONE) / 1.5);
          if (strength > 0.012) traces.push({ ...center(id), strength });
        }
      }
      return {
        ants: ants.map(({ id, x, y, angle, mode, action, actionTime, actionDuration,
          payloadKind, payloadBytes, payloadTaskId, entryTime }) => ({
          id, x, y, angle, mode, carrying: mode === 'return' || mode === 'homing',
          action, actionProgress: action ? Math.min(1, actionTime / actionDuration) : 0,
          payloadKind, payloadBytes, payloadTaskId,
          entryProgress: mode === 'deposit' ? Math.min(1, entryTime / ENTRY_SECONDS) : 0
        })),
        fileFood: fileFood ? fileTaskSnapshot(fileFood) : null,
        fileFoods: [...fileFoods.values()].map(fileTaskSnapshot),
        pheromone: traces,
        explorationPheromone: options.includeExploration ? activeExploration.map((id) => ({
          ...center(id), strength: explorationPheromone[id] / EXPLORATION_MAX
        })) : undefined,
        iterations,
        discoveries,
        completedTrips,
        bestPath: options.includeBestPath === false ? null :
          bestPath ? bestPath.map((value) => ({ ...value })) : null,
        bestLength,
        gridSize,
        cols,
        rows,
        blockedNest,
        blockedFood,
        elapsed
      };
    }

    buildEdgeClearances();
    buildTerrain();
    reset();
    return { step, snapshot, setTerrain, resize, canReach, setFileFood, setFileFoods, reset };
  }

  global.createColony = createColony;
})(typeof window !== 'undefined' ? window : globalThis);
