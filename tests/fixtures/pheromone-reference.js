// Frozen pre-optimization glow renderer for visual regression checks.
function referencePheromones(time) {
  if (!state.showPheromones || !state.colony || !state.visible) return;
  if (!state.pheromoneWork) {
    if (state.pheromoneLayer && time - state.lastPheromoneCapture < PHEROMONE_REFRESH_MS) return;
    const layer = state.pheromoneScratch || document.createElement('canvas');
    const width = Math.max(1, Math.ceil(state.width * PHEROMONE_SCALE));
    const height = Math.max(1, Math.ceil(state.height * PHEROMONE_SCALE));
    if (layer.width !== width) layer.width = width;
    if (layer.height !== height) layer.height = height;
    const trailContext = layer.getContext('2d', { alpha: true });
    trailContext.setTransform(PHEROMONE_SCALE, 0, 0, PHEROMONE_SCALE, 0, 0);
    trailContext.clearRect(0, 0, state.width, state.height);
    trailContext.globalCompositeOperation = 'lighter';
    const traces = state.colony.snapshot({
      includePheromone: true, includeExploration: true, includeBestPath: false
    });
    state.pheromoneWork = { layer, context: trailContext,
      exploration: traces.explorationPheromone, food: traces.pheromone, index: 0 };
    state.pheromoneScratch = null;
    state.lastPheromoneCapture = time;
  }
  const work = state.pheromoneWork;
  const trailContext = work.context;
  const explorationCount = work.exploration.length;
  const end = Math.min(explorationCount + work.food.length,
    work.index + PHEROMONE_TRACES_PER_FRAME);
  for (; work.index < end; work.index += 1) {
    const exploring = work.index < explorationCount;
    const trace = exploring ? work.exploration[work.index] :
      work.food[work.index - explorationCount];
    const strength = Math.min(1, Math.max(0, trace.strength));
    trailContext.fillStyle = exploring
      ? `rgba(0, 255, 246, ${strength * 0.08})`
      : `rgba(255, 134, 0, ${strength * 0.12})`;
    trailContext.beginPath();
    trailContext.arc(trace.x, trace.y, (exploring ? 4.5 : 5.5) + strength * 2.5,
      0, Math.PI * 2);
    trailContext.fill();
    trailContext.fillStyle = exploring
      ? `rgba(80, 255, 250, ${strength * 0.42})`
      : `rgba(255, 224, 92, ${strength * 0.58})`;
    trailContext.beginPath();
    trailContext.arc(trace.x, trace.y, (exploring ? 1.2 : 1.5) +
      strength * (exploring ? 0.8 : 1), 0, Math.PI * 2);
    trailContext.fill();
  }
  if (work.index === explorationCount + work.food.length) {
    trailContext.globalCompositeOperation = 'source-over';
    state.pheromoneScratch = state.pheromoneLayer;
    state.pheromoneLayer = work.layer;
    state.pheromoneWork = null;
  }
}
