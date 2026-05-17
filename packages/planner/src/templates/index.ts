import type { RaceType, RaceTemplate } from '../types.js';
export { sprintTemplate } from './sprint.js';
export { olympicTemplate } from './olympic.js';
export { template703 } from './703.js';
export { fullTemplate } from './full.js';
export { halfMarathonTemplate } from './half-marathon.js';

import { sprintTemplate } from './sprint.js';
import { olympicTemplate } from './olympic.js';
import { template703 } from './703.js';
import { fullTemplate } from './full.js';
import { halfMarathonTemplate } from './half-marathon.js';

export const TEMPLATES: Record<RaceType, RaceTemplate> = {
  'sprint': sprintTemplate,
  'olympic': olympicTemplate,
  '703': template703,
  'full': fullTemplate,
  'half-marathon': halfMarathonTemplate,
};
